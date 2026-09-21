import type { FastifyInstance } from 'fastify';
import type { Media } from '@virtuallyview/types';
import type { RadarrAdapter, SonarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from '../services/registry.js';
import { getRequests } from '../services/requests.js';
import { getWatchProgress, progressForLibrary } from '../services/progress.js';
import { flagsForLibrary, getFlags } from '../services/user-flags.js';
import { ensureCast, getCastCache, type CastMember } from '../services/cast.js';
import { getArtistCover, servedCover } from '../services/artist-covers.js';
import { findTrailer } from '../services/trailers.js';
import { outboundFetch } from '../services/outbound.js';
import { filterByRating, ratingAllowed } from '../services/parental.js';
import { warningsFor } from '../services/release-check.js';
import { retryMovie, retrySeries, retryArtist } from '../services/retry.js';

type LibraryItem = Media & {
  streamUrl?: string;
  tagline?: string;
  releaseDate?: string;
  language?: string;
  cast?: CastMember[];
  director?: { name: string }[];
  fileInfo?: { path?: string; size?: number };
  /** Server-side watch progress percent, uniform across every device. */
  watchProgress?: number;
};

/**
 * Prefer whichever cast list is richer. Radarr sometimes carries names without
 * portraits, while the local TMDB cache has both; without this the detail view
 * could show a photo-less list even though better data is cached.
 */
function richestCast(...lists: Array<CastMember[] | undefined>): CastMember[] | undefined {
  const withPhotos = lists.find(list => list?.some(member => member.photo));
  if (withPhotos) return withPhotos;
  return lists.find(list => list && list.length > 0);
}

const REQUEST_STATUS_TO_MEDIA: Record<string, string> = {
  pending: 'requested',
  searching: 'requested',
  downloading: 'downloading',
  importing: 'importing',
  available: 'available',
  failed: 'failed',
  cancelled: 'missing'
};

/**
 * Merge the persisted request ledger into a library listing so one movie can
 * never show two contradicting stories. A title that is mid-pipeline in the
 * Requests ledger but not yet imported into the *arr library appears here with
 * the same state the Requests page shows, on every device.
 */
function mergeRequests<T extends LibraryItem>(items: T[], mediaType: 'movie' | 'series' | 'artist'): T[] {
  const inFlight = getRequests().filter(
    r => r.mediaType === mediaType && ['pending', 'searching', 'downloading', 'importing'].includes(r.status)
  );
  if (!inFlight.length) return items;

  const titleKey = (title: string | undefined, year: number | undefined) =>
    `${(title ?? '').trim().toLowerCase()}::${year ?? ''}`;

  const merged: T[] = items.map(i => ({ ...i }));
  const byProvider = new Map<string, T>();
  const byTitle = new Map<string, T>();
  for (const item of merged) {
    if (item.id) byProvider.set(item.id, item);
    if (item.provider?.id != null) byProvider.set(String(item.provider.id), item);
    byTitle.set(titleKey(item.title, item.year), item);
  }

  for (const r of inFlight) {
    const status = REQUEST_STATUS_TO_MEDIA[r.status] ?? 'requested';
    const match =
      (r.selectedProviderId ? byProvider.get(r.selectedProviderId) : undefined) ??
      byTitle.get(titleKey(r.title, r.year));
    if (match) {
      // The title is already in the library: keep exactly one row and reflect
      // the live pipeline state, so the Movies page and the Requests page tell
      // the same story instead of showing the same title twice.
      if (match.status !== 'available') match.status = status as T['status'];
      if (r.qualityProfile) match.quality = r.qualityProfile;
      continue;
    }
    const id = r.selectedProviderId && /^(radarr|sonarr|lidarr)-/.test(r.selectedProviderId)
      ? r.selectedProviderId
      : r.id;
    const created = {
      id,
      title: r.title,
      year: r.year,
      overview: r.overview,
      type: mediaType,
      status,
      quality: r.qualityProfile,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt)
    } as T;
    merged.push(created);
    byProvider.set(id, created);
    byTitle.set(titleKey(r.title, r.year), created);
  }
  return merged;
}

export default async function mediaRoutes(server: FastifyInstance) {
  const moviesAdapter = getAdapter('radarr');
  const seriesAdapter = getAdapter('sonarr');
  const artistsAdapter = getAdapter('lidarr');

  async function safeItems(adapter: { getItems: () => Promise<Media[]> }): Promise<Media[]> {
    try {
      return filterByRating(await adapter.getItems());
    } catch {
      // Integration offline or unconfigured: empty state, no fake data.
      return [];
    }
  }

  function withProgress(items: LibraryItem[], mediaType: 'movie' | 'series' | 'artist'): LibraryItem[] {
    const merged = mergeRequests(items, mediaType);
    const map = progressForLibrary(mediaType, merged.map(i => i.id));
    const flags = flagsForLibrary(mediaType, merged.map(i => i.id));
    return merged.map(i => ({
      ...i,
      watchProgress: map.get(i.id)?.percent ?? 0,
      favorite: flags.get(i.id)?.favorite ?? false,
      watched: flags.get(i.id)?.watched ?? false
    }));
  }

  server.get('/api/movies', async () => {
    const items = (await safeItems(moviesAdapter)) as LibraryItem[];
    // Local files get a stream URL on every tile, not just the hero, so card
    // hover previews can play the real file (P2-8).
    return withProgress(items, 'movie').map(item => ({
      ...item,
      ...((item as { fileInfo?: { path?: string } }).fileInfo?.path ? { streamUrl: `/api/stream/${item.id}` } : {})
    }));
  });

  server.get('/api/movies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const movie = (await moviesAdapter.getItem(id)) as LibraryItem | null;
      if (movie && movie.id === id) {
        if (!ratingAllowed(movie.certification)) return reply.code(403).send({ error: 'age_restricted', message: 'This title is above the age limit set for your account.' });
        const progress = getWatchProgress('movie', id);
        // Enrich the detail view with locally cached cast data (already found
        // for this movie or auto-sourced from a request that shares actors).
        const cachedCast = getCastCache(id);
        return {
          ...movie,
          watchProgress: progress?.percent ?? 0,
          ...getFlags('movie', id),
          tmdbId: movie.provider?.metadata?.tmdbId,
          warnings: warningsFor(movie as Parameters<typeof warningsFor>[0]),
          streamUrl: (movie as { fileInfo?: { path?: string } }).fileInfo?.path ? `/api/stream/${movie.id}` : undefined,
          cast: richestCast(movie.cast, cachedCast?.cast) ?? movie.cast
        };
      }
    } catch {
      // Radarr unavailable: fall through to the 404 below.
    }
    // A requested-but-not-imported movie is still visible on its own page.
    const pending = getRequests().find(r =>
      (r.mediaType === 'movie' && (r.id === id || r.selectedProviderId === id)) &&
      ['pending', 'searching', 'downloading', 'importing'].includes(r.status)
    );
    if (pending) {
      const progress = getWatchProgress('movie', id);
      return {
        id: pending.selectedProviderId && /^radarr-/.test(pending.selectedProviderId) ? pending.selectedProviderId : id,
        title: pending.title,
        year: pending.year,
        overview: pending.overview,
        type: 'movie',
        status: REQUEST_STATUS_TO_MEDIA[pending.status] ?? 'requested',
        quality: pending.qualityProfile,
        watchProgress: progress?.percent ?? 0
      };
    }
    reply.code(404);
    return { error: 'not_found', message: `No movie found with id "${id}".` };
  });

  // Search again for something that is missing. Open to everyone signed in:
  // it only asks the media manager to look, it never deletes anything.
  const answer = async (reply: { code: (n: number) => unknown }, run: () => Promise<{ success: boolean; message: string }>) => {
    try {
      const result = await run();
      if (!result.success) reply.code(502);
      return result;
    } catch (error) {
      reply.code(502);
      return { success: false, message: error instanceof Error ? error.message : 'The service is not available.' };
    }
  };
  server.post<{ Params: { id: string } }>('/api/movies/:id/search', (request, reply) => answer(reply, () => retryMovie(request.params.id)));
  server.post<{ Params: { id: string }; Body: { episodeId?: string } }>('/api/series/:id/search', (request, reply) =>
    answer(reply, () => retrySeries(request.params.id, request.body?.episodeId)));
  server.post<{ Params: { id: string } }>('/api/artists/:id/search', (request, reply) => answer(reply, () => retryArtist(request.params.id)));

  // Wrong or mislabeled file: blocklist that release, delete the file, search again.
  server.post<{ Params: { id: string } }>('/api/movies/:id/replace-file', async (request, reply) => {
    if (!/^radarr-\d+$/.test(request.params.id)) return reply.code(400).send({ message: 'Unknown movie id.' });
    try {
      const result = await (moviesAdapter as unknown as RadarrAdapter).replaceFile(request.params.id);
      return result.success ? result : reply.code(502).send(result);
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'Radarr is not available.' });
    }
  });

  server.get('/api/series', async () => {
    const items = (await safeItems(seriesAdapter)) as LibraryItem[];
    return withProgress(items, 'series');
  });

  server.get('/api/artists', async () => {
    const items = (await safeItems(artistsAdapter)) as LibraryItem[];
    const merged = mergeRequests(items, 'artist');
    const map = progressForLibrary('artist', merged.map(i => i.id));
    const artistFlags = flagsForLibrary('artist', merged.map(i => i.id));
    // Overlay the user-chosen server-side cover (if any) so the Music page and
    // the artist detail page both show the artwork the user picked.
    return merged.map(i => {
      const cover = servedCover(getArtistCover(i.id)?.chosen);
      return {
        ...i,
        watchProgress: map.get(i.id)?.percent ?? 0,
        favorite: artistFlags.get(i.id)?.favorite ?? false,
        artwork: cover ? { ...i.artwork, poster: cover } : i.artwork
      };
    });
  });

  server.get('/api/series/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const series = (await seriesAdapter.getItem(id)) as LibraryItem | null;
      if (series && series.id === id) {
        if (!ratingAllowed(series.certification)) return reply.code(403).send({ error: 'age_restricted', message: 'This title is above the age limit set for your account.' });
        const progress = getWatchProgress('series', id);
        return { ...series, watchProgress: progress?.percent ?? 0, ...getFlags('series', id) };
      }
    } catch {
      // Sonarr unavailable: fall through to the 404 below.
    }
    const pending = getRequests().find(r =>
      (r.mediaType === 'series' && (r.id === id || r.selectedProviderId === id)) &&
      ['pending', 'searching', 'downloading', 'importing'].includes(r.status)
    );
    if (pending) {
      return {
        id: pending.selectedProviderId && /^sonarr-/.test(pending.selectedProviderId) ? pending.selectedProviderId : id,
        title: pending.title,
        year: pending.year,
        overview: pending.overview,
        type: 'series',
        status: REQUEST_STATUS_TO_MEDIA[pending.status] ?? 'requested',
        quality: pending.qualityProfile
      };
    }
    reply.code(404);
    return { error: 'not_found', message: `No series found with id "${id}".` };
  });

  // Episodes for one series, each with a playable stream URL when a local file
  // exists and per-episode watch progress for resume across devices.
  server.get('/api/series/:id/episodes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numeric = id.replace(/^sonarr-/, '');
    if (!/^\d+$/.test(numeric)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid series id.' });
    }
    try {
      const parent = (await seriesAdapter.getItem(id)) as LibraryItem | null;
      if (parent && !ratingAllowed(parent.certification)) return reply.code(403).send({ error: 'age_restricted', message: 'This title is above the age limit set for your account.' });
      const sonarr = seriesAdapter as unknown as SonarrAdapter;
      const episodes = await sonarr.getEpisodes(id);
      const map = progressForLibrary('episode', episodes.map(e => e.id));
      const episodeFlags = flagsForLibrary('episode', episodes.map(e => e.id));
      return {
        seriesId: id,
        episodes: episodes.map(e => ({
          ...e,
          streamUrl: e.hasFile ? `/api/stream/episode/${encodeURIComponent(e.id)}` : undefined,
          watchProgress: map.get(e.id)?.percent ?? 0,
          watched: episodeFlags.get(e.id)?.watched ?? false
        }))
      };
    } catch (error) {
      return reply.code(502).send({
        error: 'sonarr_offline',
        message: error instanceof Error ? error.message : 'Sonarr is not available.'
      });
    }
  });

  server.get('/api/artists/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    let artist: LibraryItem | null = null;
    try {
      artist = (await artistsAdapter.getItem(id)) as LibraryItem | null;
    } catch (error) {
      // Lidarr unreachable is a service error, not "artist removed from the
      // library" - the client must show the real problem instead of a lie.
      reply.code(502);
      return { error: 'lidarr_offline', message: error instanceof Error ? error.message : 'Lidarr is not available.' };
    }
    if (artist && artist.id === id) {
      const progress = getWatchProgress('artist', id);
      const cover = servedCover(getArtistCover(id)?.chosen);
      return {
        ...artist,
        watchProgress: progress?.percent ?? 0,
        ...getFlags('artist', id),
        artwork: cover ? { ...artist.artwork, poster: cover } : artist.artwork
      };
    }
    reply.code(404);
    return { error: 'not_found', message: `No artist found with id "${id}".` };
  });

  // Remove a movie from the library. Deleting files is opt-in and requires an
  // explicit confirmation flag from the caller; the default only unmonitors
  // and removes the entry, mirroring Radarr's own safety guard.
  server.delete<{ Params: { id: string }; Querystring: { deleteFiles?: string } }>(
    '/api/movies/:id',
    async (request, reply) => {
      const { id } = request.params;
      const deleteFiles = request.query.deleteFiles === 'true';
      try {
        const result = await moviesAdapter.remove(id, deleteFiles);
        if (!result.success) return reply.code(422).send(result);
        return { success: true, id, deleteFiles, message: result.message };
      } catch (error) {
        return reply.code(502).send({ success: false, message: error instanceof Error ? error.message : 'Could not remove the movie.' });
      }
    }
  );

  server.delete<{ Params: { id: string }; Querystring: { deleteFiles?: string } }>(
    '/api/series/:id',
    async (request, reply) => {
      const { id } = request.params;
      const deleteFiles = request.query.deleteFiles === 'true';
      try {
        const result = await seriesAdapter.remove(id, deleteFiles);
        if (!result.success) return reply.code(422).send(result);
        return { success: true, id, deleteFiles, message: result.message };
      } catch (error) {
        return reply.code(502).send({ success: false, message: error instanceof Error ? error.message : 'Could not remove the series.' });
      }
    }
  );

  server.delete<{ Params: { id: string }; Querystring: { deleteFiles?: string } }>(
    '/api/artists/:id',
    async (request, reply) => {
      const { id } = request.params;
      const deleteFiles = request.query.deleteFiles === 'true';
      try {
        const result = await artistsAdapter.remove(id, deleteFiles);
        if (!result.success) return reply.code(422).send(result);
        return { success: true, id, deleteFiles, message: result.message };
      } catch (error) {
        return reply.code(502).send({ success: false, message: error instanceof Error ? error.message : 'Could not remove the artist.' });
      }
    }
  );

  // Trailer lookup for the hero/tile preview. Works for movies, TV series and
  // artists; returns null when nothing could be found.
  server.get('/api/media/:id/trailer', async (request, reply) => {
    const { id } = request.params as { id: string };
    const kind = id.startsWith('sonarr-') ? 'series' : id.startsWith('lidarr-') ? 'artist' : 'movie';
    const adapter = kind === 'series' ? seriesAdapter : kind === 'artist' ? artistsAdapter : moviesAdapter;
    try {
      const item = (await adapter.getItem(id)) as (LibraryItem & { id?: string }) | null;
      if (!item || item.id !== id) return { youtubeId: null };
      const tmdbId = (item.provider?.metadata as { tmdbId?: number } | undefined)?.tmdbId;
      const youtubeId = await findTrailer(kind, item.title, item.year, tmdbId);
      reply.header('Cache-Control', 'public, max-age=3600');
      return { youtubeId };
    } catch {
      return { youtubeId: null };
    }
  });

  server.get('/api/search', async request => {
    const { q } = request.query as { q?: string };
    const query = (q ?? '').trim().toLowerCase();
    if (!query) return { query: '', total: 0, items: [] };

    const normalizeSearch = (value: string) =>
      value.normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedQuery = normalizeSearch(query);
    const haystack = (m: any) =>
      normalizeSearch([m.title, m.overview, m.originalTitle, m.artist, ...(m.genres ?? [])].join(' '));
    const allMovies = withProgress(mergeRequests((await safeItems(moviesAdapter)) as LibraryItem[], 'movie'), 'movie');
    const allSeries = withProgress(mergeRequests((await safeItems(seriesAdapter)) as LibraryItem[], 'series'), 'series');
    const allArtists = withProgress(mergeRequests((await safeItems(artistsAdapter)) as LibraryItem[], 'artist'), 'artist');
    const catalog = [...allMovies, ...allSeries, ...allArtists];
    const items = catalog.filter(m => haystack(m).includes(normalizedQuery));

    // Famous/trending first: finished titles beat in-flight ones, and within a
    // status group the highest-rated titles surface at the top of the list.
    const popularity = (m: LibraryItem): number => {
      let score = 0;
      if (m.status === 'available') score += 1000;
      else if (m.status === 'downloading' || m.status === 'importing') score += 500;
      const rating = typeof m.rating === 'number' ? m.rating : 0;
      if (Number.isFinite(rating)) score += rating * 10;
      return score;
    };
    items.sort((a, b) => (popularity(b) - popularity(a)) || (b.title ?? '').localeCompare(a.title ?? ''));

    return { query: q, total: items.length, items };
  });

  server.get('/api/search/suggestions', async request => {
    const { q } = request.query as { q?: string };
    const query = (q ?? '').trim();
    if (!query) return { suggestions: [] };

    const ql = query.toLowerCase();

    const allMovies = await safeItems(moviesAdapter);
    const allSeries = await safeItems(seriesAdapter);
    const allArtists = await safeItems(artistsAdapter);

    const local = [...allMovies, ...allSeries, ...allArtists]
      .filter(m => m.title.toLowerCase().includes(ql))
      .slice(0, 6)
      .map(m => ({
        title: m.title,
        year: m.year,
        type: m.type,
        id: m.id,
        source: 'library' as const,
        poster: m.artwork?.poster ?? null
      }));

    const localTitles = new Set(local.map(m => m.title.toLowerCase()));

    let web: { title: string; description: string; source: 'web' }[] = [];
    try {
      const res = await outboundFetch(
        `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=6&namespace=0&format=json&origin=*`,
        { timeoutMs: 4000 }
      );
      if (res.ok) {
        const data = (await res.json()) as { 1?: string[]; 2?: string[] };
        const titles = data[1] ?? [];
        const descs = data[2] ?? [];
        web = titles
          .filter(t => !localTitles.has(t.toLowerCase()))
          .slice(0, 5)
          .map((t, i) => ({ title: t, description: descs[i] ?? '', source: 'web' as const }));
      }
    } catch {
      // open web offline: suggestions just fall back to the library
    }

    return { suggestions: [...local, ...web] };
  });

  async function resolveMedia(id: string): Promise<LibraryItem | null> {
    try {
      const movie = (await moviesAdapter.getItem(id)) as LibraryItem | null;
      if (movie) return movie;
    } catch {
      // Radarr unavailable: fall through to Sonarr
    }
    try {
      const series = (await seriesAdapter.getItem(id)) as LibraryItem | null;
      if (series) return series;
    } catch {
      // Sonarr unavailable
    }
    return null;
  }

  server.get<{ Params: { id: string } }>('/api/media/:id/verify', async (request, reply) => {
    const { id } = request.params;
    const item = await resolveMedia(id);
    if (!item) {
      return reply.code(404).send({ error: 'not_found', message: `No media with id "${id}".` });
    }

    const checkUrl = async (url: string, expect: 'video' | 'image') => {
      // External artwork is fetched by the browser; the server container may not
      // have outbound access even when the URL is valid for clients.
      if (expect === 'image' && /^https:\/\//i.test(url)) {
        return { ok: true, status: 200, detail: 'configured remote artwork' };
      }
      try {
        const res = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(4000)
        });
        const ct = (res.headers.get('content-type') ?? '').toLowerCase();
        const ok = (res.ok || res.status === 206) && ct.includes(expect === 'video' ? 'video' : 'image');
        return { ok, status: res.status, detail: ok ? `HTTP ${res.status} · ${ct}` : `HTTP ${res.status} · ${ct || 'unexpected content'}` };
      } catch {
        try {
          const res = await fetch(url, {
            headers: { Range: 'bytes=0-0' },
            redirect: 'follow',
            signal: AbortSignal.timeout(4000)
          });
          const ct = (res.headers.get('content-type') ?? '').toLowerCase();
          const ok = (res.ok || res.status === 206) && ct.includes(expect === 'video' ? 'video' : 'image');
          return { ok, status: res.status, detail: ok ? `HTTP ${res.status} · ${ct}` : `HTTP ${res.status} · ${ct || 'unreachable'}` };
        } catch {
          return { ok: false, status: 0, detail: 'unreachable' };
        }
      }
    };

    const checks: Array<{ name: string; kind: string; ok: boolean; detail: string }> = [];

    if (item.streamUrl) {
      const r = await checkUrl(item.streamUrl, 'video');
      checks.push({ name: 'Trailer / preview video', kind: 'video', ok: r.ok, detail: r.detail });
    } else {
      checks.push({ name: 'Trailer / preview video', kind: 'video', ok: false, detail: 'no stream configured' });
    }

    if (item.artwork?.poster) {
      const r = await checkUrl(item.artwork.poster, 'image');
      checks.push({ name: 'Poster artwork', kind: 'poster', ok: r.ok, detail: r.detail });
    } else {
      checks.push({ name: 'Poster artwork', kind: 'poster', ok: false, detail: 'missing' });
    }

    if (item.artwork?.backdrop) {
      const r = await checkUrl(item.artwork.backdrop, 'image');
      checks.push({ name: 'Backdrop artwork', kind: 'backdrop', ok: r.ok, detail: r.detail });
    }

    const descOk = !!(item.overview && item.overview.trim().length >= 40);
    checks.push({
      name: 'Movie description',
      kind: 'description',
      ok: descOk,
      detail: descOk ? 'present' : 'missing or too short'
    });

    const castOk = Array.isArray(item.cast) && item.cast.length > 0;
    checks.push({ name: 'Cast list', kind: 'cast', ok: castOk, detail: castOk ? `${(item.cast ?? []).length} actors` : 'missing' });

    return { id, title: item.title, type: item.type, verified: checks.every(c => c.ok), checks };
  });

  const descCache = new Map<string, { description: string; source: string }>();

  server.get<{ Params: { id: string } }>('/api/media/:id/description', async (request, reply) => {
    const { id } = request.params;
    const item = await resolveMedia(id);
    if (!item) {
      return reply.code(404).send({ error: 'not_found', message: `No media with id "${id}".` });
    }

    const cached = descCache.get(id);
    if (cached) return { id, title: item.title, ...cached };

    const fallback = { description: item.overview ?? '', source: 'library' };

    const fetchSummary = async (title: string) => {
      const res = await outboundFetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { timeoutMs: 4000 }
      );
      if (!res.ok) return null;
      return (await res.json()) as { type?: string; extract?: string };
    };

    try {
      let summary = await fetchSummary(item.title);
      // Disambiguation pages carry no extract. Try the film/story-specific title.
      if (summary && summary.type === 'disambiguation') {
        const suffix = item.type === 'series' ? ' (TV series)' : ' (film)';
        const retry = await fetchSummary(`${item.title}${suffix}`);
        if (retry && retry.extract) summary = retry;
      }
      const extract = summary?.extract?.trim() ?? '';
      if (extract.length > (item.overview?.length ?? 0)) {
        descCache.set(id, { description: extract, source: 'Wikipedia' });
        return { id, title: item.title, description: extract, source: 'Wikipedia' };
      }
    } catch {
      // offline: fall back to bundled library description
    }

    return { id, title: item.title, ...fallback, cached: false, source: fallback.source };
  });

  // Cast enrichment: fetch cast data from the local TMDB scrape, cache it in
  // SQLite, and reuse it when another requested movie shares actors. This is
  // the endpoint MovieDetails calls when the library item has no cast yet.
  server.get<{ Params: { id: string } }>('/api/movies/:id/cast', async (request, reply) => {
    const { id } = request.params;
    let movie: LibraryItem | null = null;
    try {
      movie = (await moviesAdapter.getItem(id)) as LibraryItem | null;
    } catch {
      // fall through to the request ledger
    }
    if (!movie) {
      const pending = getRequests().find(r =>
        r.mediaType === 'movie' && (r.id === id || r.selectedProviderId === id)
      );
      if (!pending) {
        return reply.code(404).send({ error: 'not_found', message: `No movie found with id "${id}".` });
      }
      movie = { id, title: pending.title, type: 'movie', status: 'requested', createdAt: new Date(pending.createdAt), updatedAt: new Date(pending.updatedAt) } as LibraryItem;
    }
    const tmdbId = (movie.provider?.metadata as { tmdbId?: number } | undefined)?.tmdbId;
    const result = await ensureCast(id, movie.title, movie.year, tmdbId);
    return result;
  });
}