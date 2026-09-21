import type { FastifyInstance } from 'fastify';
import type { Media } from '@virtuallyview/types';
import { getAdapter } from '../services/registry.js';
import { getDownloads as getQueueDownloads } from '../services/real-downloads.js';
import { allWatchProgress } from '../services/progress.js';
import { listFlagged } from '../services/user-flags.js';
import { filterByRating } from '../services/parental.js';
import { lastWatchedSeries } from '../services/progress.js';
import { flagsForLibrary } from '../services/user-flags.js';
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
    const [movies, series] = await Promise.all([safeItems(radarr), safeItems(sonarr)]);
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
    const heroSeries = seriesByAdded.slice(0, 3).map(i => toHero(i, 'TV Series'));
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

    return {
      hero: heroCandidates[0] ?? null,
      heroCandidates,
      rails: [
        ...(continueItems.length ? [{ id: 'continue-watching', title: 'Continue Watching', items: continueItems.slice(0, 12) }] : []),
        ...(nextUp.length ? [{ id: 'next-up', title: 'Next Up', items: nextUp }] : []),
        { id: 'trending-movies', title: 'Trending Movies', href: '/movies', items: withStream(byRating(movies, 10)) },
        { id: 'trending-series', title: 'Trending TV Shows', href: '/series', items: withStream(byRating(series, 10)) },
        { id: 'trending-music', title: 'Trending Music', href: '/music', items: byRating(artists, 10) },
        { id: 'recent', title: 'Recently Added', href: '/movies', items: withStream(sortedByAdded.slice(0, 10)) },
        ...(myList.length ? [{ id: 'my-list', title: 'My List', items: myList }] : []),
        { id: 'downloads', title: 'Downloads', href: '/downloads', items: downloads, kind: 'download' }
      ]
    };
  });
}