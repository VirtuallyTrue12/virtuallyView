import { withoutConcerts } from '../services/concert-movies.js';
import type { FastifyInstance } from 'fastify';
import type { Media } from '@virtuallyview/types';
import { getAdapter } from '../services/registry.js';
import { getDownloads as getQueueDownloads } from '../services/real-downloads.js';
import { allWatchProgress, householdViewRows } from '../services/progress.js';
import { listFlagged, flagSignalRows } from '../services/user-flags.js';
import { filterByRating } from '../services/parental.js';
import { currentActor } from '../services/user-context.js';
import { lastWatchedSeries } from '../services/progress.js';
import { newForYouRails } from '../services/new-for-you.js';
import { flagsForLibrary } from '../services/user-flags.js';
import { forYouRail } from '../services/for-you.js';
import { savedHomeLayout } from '../services/home-layout.js';
import { applyHomeLayout, pickAnchors, similarTitles, topHousehold } from '../services/home-rails.js';
import type { SonarrAdapter } from '@virtuallyview/integrations';

export default async function dashboardRoutes(server: FastifyInstance) {
  async function safeItems(a: { getItems: () => Promise<Media[]> }): Promise<Media[]> {
    try {
      return filterByRating(await a.getItems());
    } catch {
      // Radarr/Sonarr offline or unconfigured: empty state, no fake data.
      return [];
    }
  }

  const byRating = (items: Media[], limit: number) =>
    [...items]
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

  server.get('/api/dashboard', async () => {
    const radarr = getAdapter('radarr');
    const sonarr = getAdapter('sonarr');
    const lidarr = getAdapter('lidarr');
    const [allFilms, series] = await Promise.all([safeItems(radarr), safeItems(sonarr)]);
    const movies = withoutConcerts(allFilms);
    const artists = await safeItems(lidarr);

    const sortedByAdded = [...movies].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    // Rail tiles get the same local-file stream URL the hero already uses, so
    // a hover on any downloaded tile can preview the actual file.
    const withStream = (items: (typeof movies)[number][]) => items.map(item => ({
      ...item,
      ...((item as { fileInfo?: { path?: string } }).fileInfo?.path ? { streamUrl: `/api/stream/${item.id}` } : {})
    }));
    // Hero rotates across movies, TV shows and artists. Movies with a local
    // file carry a stream URL so the hero can preview the real file; TV and
    // artists preview through a trailer lookup instead.
    const toHero = (item: (typeof movies)[number], tagline: string) => ({
      ...item,
      tagline,
      inLibrary: item.status === 'available',
      ...((item as { fileInfo?: { path?: string } }).fileInfo?.path && item.type === 'movie' ? { streamUrl: `/api/stream/${item.id}` } : {})
    });
    const seriesByAdded = [...series].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const heroMovies = sortedByAdded.slice(0, 4).map(i => toHero(i, 'Recently Added Movie'));
    // A show with downloaded episodes previews the real file, same as a movie (a random episode, not
    // necessarily the pilot, so the hero doesn't always spoil episode one); only a show with nothing
    // downloaded yet falls back to an online trailer lookup.
    const heroSeries = await Promise.all(seriesByAdded.slice(0, 3).map(async i => {
      const hero = toHero(i, 'TV Series');
      if (i.status !== 'available') return hero;
      try {
        const episodes = (await (sonarr as unknown as SonarrAdapter).getEpisodes(i.id)).filter(e => e.hasFile);
        const pick = episodes[Math.floor(Math.random() * episodes.length)];
        return pick ? { ...hero, streamUrl: `/api/stream/episode/${encodeURIComponent(pick.id)}` } : hero;
      } catch {
        return hero; // Sonarr slow or offline: trailer fallback still works
      }
    }));
    const heroArtists = byRating(artists, 3).map(i => toHero(i, 'Featured Artist'));
    const heroCandidates: ReturnType<typeof toHero>[] = [];
    for (let i = 0; i < 4; i++) {
      for (const group of [heroMovies, heroSeries, heroArtists]) {
        if (group[i]) heroCandidates.push(group[i]);
      }
    }

    // Same queue the Downloads page reads, so both surfaces can never disagree.
    const artworkByMedia = new Map<string, { poster?: string; backdrop?: string }>();
    for (const item of [...movies, ...series, ...artists]) {
      if (item.artwork) artworkByMedia.set(item.id, item.artwork);
    }
    const downloads = (await getQueueDownloads().catch(() => []))
      .map(item => ({
        ...item,
        artwork: item.artwork ?? (item.mediaId ? artworkByMedia.get(item.mediaId) : undefined)
      }));

    // Per-user rails: what this viewer left half-watched, and their My List.
    const byId = new Map<string, Media>([...movies, ...series, ...artists].map(i => [i.id, i]));
    const continueItems: Array<Record<string, unknown>> = [];
    const seenSeries = new Set<string>();
    for (const row of allWatchProgress()) {
      if (row.percent < 1 || row.percent >= 96) continue;
      if (row.mediaType === 'movie') {
        const movie = byId.get(row.mediaId);
        if (movie) continueItems.push({ ...movie, watchProgress: row.percent, href: `/movies/${movie.id}/play` });
      } else if (row.mediaType === 'episode' && row.context && !seenSeries.has(row.context)) {
        const show = byId.get(row.context);
        if (show) {
          seenSeries.add(row.context);
          continueItems.push({ ...show, watchProgress: row.percent, href: `/series/${show.id}/watch/${encodeURIComponent(row.mediaId)}` });
        }
      }
    }
    // Next Up: for shows this viewer has started, the first episode after the
    // last one they touched, when that one is finished and the next has a file.
    const nextUp: Array<Record<string, unknown>> = [];
    const inProgressEpisodes = new Set(allWatchProgress().filter(r => r.mediaType === 'episode').map(r => r.mediaId));
    for (const last of lastWatchedSeries(6)) {
      const show = byId.get(last.seriesId);
      if (!show || inProgressEpisodes.has(last.episodeId)) continue;
      try {
        const episodes = (await (sonarr as unknown as SonarrAdapter).getEpisodes(last.seriesId))
          .filter(e => e.seasonNumber > 0 || e.hasFile)
          .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
        const at = episodes.findIndex(e => e.id === last.episodeId);
        if (at < 0) continue;
        const seen = flagsForLibrary('episode', episodes.map(e => e.id));
        const next = episodes.slice(at + 1).find(e => e.hasFile && !seen.get(e.id)?.watched);
        if (next) {
          nextUp.push({ ...show, href: `/series/${show.id}/watch/${encodeURIComponent(next.id)}`, nextEpisode: `S${next.seasonNumber} E${next.episodeNumber}` });
        }
      } catch {
        // Sonarr slow or offline: skip this show
      }
    }
    const typeOf = (t: string) => (t === 'movie' ? 'movie' : t === 'series' ? 'series' : 'artist');
    const myList = listFlagged('favorite')
      .map(f => byId.get(f.mediaId))
      .filter((i): i is Media => !!i && i.type === typeOf(i.type))
      .map(i => ({ ...i, favorite: true }));

    // A Kids profile gets a short, family-only home: its own Continue Watching and My List, plus family
    // titles (the rating limit already keeps those to G and PG).
    if (currentActor().kid) {
      const family = byRating([...movies, ...series], 24);
      return {
        kids: true,
        hero: heroCandidates.find(h => h.type !== 'artist') ?? null,
        heroCandidates: heroCandidates.filter(h => h.type !== 'artist'),
        rails: [
          ...(continueItems.length ? [{ id: 'continue-watching', title: 'Continue Watching', items: continueItems.slice(0, 12) }] : []),
          { id: 'family', title: 'Family Favorites', items: withStream(family) },
          ...(myList.length ? [{ id: 'my-list', title: 'My List', items: myList }] : [])
        ]
      };
    }

    // Personal rails. Taste comes from this viewer's flags; candidates are the movies and shows
    // already in the library (the lists above are already filtered by the viewer's age limit).
    const flagRows = flagSignalRows();
    const signals = {
      finished: new Set(flagRows.filter(r => r.watched).map(r => r.mediaId)),
      thumbsUp: new Set(flagRows.filter(r => r.thumb === 1).map(r => r.mediaId)),
      thumbsDown: new Set(flagRows.filter(r => r.thumb === -1).map(r => r.mediaId))
    };
    const libraryTitles = [...movies, ...series];
    const libraryById = new Map(libraryTitles.map(i => [i.id, i]));
    const availableTitles = libraryTitles.filter(i => i.status === 'available');
    // Anchors: titles this viewer has got past half way, or finished (an episode counts for its show).
    const anchorEvents = [
      ...allWatchProgress()
        .filter(r => r.percent > 50)
        .flatMap(r => (r.mediaType === 'movie' || r.mediaType === 'series' ? [{ id: r.mediaId, at: r.updatedAt }]
          : r.mediaType === 'episode' && r.context ? [{ id: r.context, at: r.updatedAt }] : [])),
      ...flagRows.filter(r => r.watched && (r.mediaType === 'movie' || r.mediaType === 'series'))
        .map(r => ({ id: r.mediaId, at: r.updatedAt }))
    ];
    const becauseRails = pickAnchors(anchorEvents, signals.thumbsDown, new Set(libraryById.keys()), 4)
      .map(anchorId => {
        const anchor = libraryById.get(anchorId)!;
        const picks = similarTitles(anchor, availableTitles, signals, 12).map(s => s.item);
        return picks.length
          ? { id: `because-${anchor.id}`, title: `Because you watched ${anchor.title}`, items: withStream(picks) }
          : null;
      })
      .filter((rail): rail is NonNullable<typeof rail> => rail !== null)
      .slice(0, 2);

    // Top 10: what the whole household watched most in the last 7 days. Needs at least 3 titles to show.
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const top10 = topHousehold(
      householdViewRows(weekAgo).map(r => ({ userId: r.userId, id: r.mediaId, at: r.at })), now, 7, 50
    )
      .filter(t => libraryById.has(t.id))
      .slice(0, 10)
      .map((t, i) => ({ ...libraryById.get(t.id)!, rank: i + 1 }));

    // Default order; the viewer's saved order and hidden flags are applied on top of it.
    const railList = [
      ...(continueItems.length ? [{ id: 'continue-watching', title: 'Continue Watching', items: continueItems.slice(0, 12) }] : []),
      ...(nextUp.length ? [{ id: 'next-up', title: 'Next Up', items: nextUp }] : []),
      ...newForYouRails(byId, artists.map(a => a.id)),
      ...await forYouRail({ titles: libraryTitles, artists, anchorEvents, signals, kid: false }),
      ...(top10.length >= 3 ? [{ id: 'top-10', title: 'Top 10 in Your Home', items: withStream(top10), kind: 'ranked' }] : []),
      ...becauseRails,
      { id: 'trending-movies', title: 'Trending Movies', href: '/movies', items: withStream(byRating(movies, 10)) },
      { id: 'trending-series', title: 'Trending TV Shows', href: '/series', items: withStream(byRating(series, 10)) },
      { id: 'trending-music', title: 'Trending Music', href: '/music', items: byRating(artists, 10) },
      { id: 'recent', title: 'Recently Added', href: '/movies', items: withStream(sortedByAdded.slice(0, 10)) },
      ...(myList.length ? [{ id: 'my-list', title: 'My List', items: myList }] : []),
      { id: 'downloads', title: 'Downloads', href: '/downloads', items: downloads, kind: 'download' }
    ];

    return {
      hero: heroCandidates[0] ?? null,
      heroCandidates,
      rails: applyHomeLayout(railList, savedHomeLayout())
    };
  });
}