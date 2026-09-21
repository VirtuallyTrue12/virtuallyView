import { outboundFetch } from './outbound.js';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) VirtuallyView/1.0',
  'Accept-Language': 'en-US,en;q=0.9'
};

export type TrailerKind = 'movie' | 'series' | 'artist';

const cache = new Map<string, { id: string | null; at: number }>();
const TTL_OK = 24 * 60 * 60 * 1000;
const TTL_MISS = 30 * 60 * 1000;

async function fromTmdbPage(kind: 'movie' | 'tv', tmdbId: string): Promise<string | null> {
  const res = await outboundFetch(`https://www.themoviedb.org/${kind}/${tmdbId}?language=en-US`, { headers: HEADERS, timeoutMs: 10000 });
  if (!res.ok) return null;
  const html = await res.text();
  return /data-site="YouTube" data-id="([A-Za-z0-9_-]{11})"/.exec(html)?.[1] ?? null;
}

async function fromYouTubeSearch(query: string): Promise<string | null> {
  const res = await outboundFetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`, { headers: HEADERS, timeoutMs: 10000 });
  if (!res.ok) return null;
  const html = await res.text();
  return /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/.exec(html)?.[1] ?? null;
}

/**
 * Resolve a YouTube trailer id: TMDB page first (movies/TV with a known TMDB
 * id), then a YouTube search for the official trailer / music video.
 */
export async function findTrailer(kind: TrailerKind, title: string, year?: number, tmdbId?: number | string): Promise<string | null> {
  const key = `${kind}:${tmdbId ?? ''}:${title}:${year ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.id ? TTL_OK : TTL_MISS)) return hit.id;

  let id: string | null = null;
  try {
    if (tmdbId && kind !== 'artist') id = await fromTmdbPage(kind === 'movie' ? 'movie' : 'tv', String(tmdbId));
  } catch { /* fall through to search */ }
  if (!id) {
    const query = kind === 'artist'
      ? `${title} official music video`
      : kind === 'series'
        ? `${title} ${year ?? ''} tv series official trailer`
        : `${title} ${year ?? ''} official trailer`;
    try {
      id = await fromYouTubeSearch(query.replace(/\s+/g, ' ').trim());
    } catch { id = null; }
  }
  cache.set(key, { id, at: Date.now() });
  return id;
}
