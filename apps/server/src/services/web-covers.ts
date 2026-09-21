import { get, run } from '../db/app-db.js';
import { outboundFetch } from './outbound.js';

/**
 * Web cover lookup for media that has no artwork in the local metadata
 * (request candidates, search misses). Sources are tried in order of
 * reliability: Wikipedia page image, a configured SearXNG instance, DuckDuckGo
 * image search, then Bing's image RSS. Nothing is returned when every source
 * fails, so the UI can show a real empty state instead of a fake image.
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // keep a week, stale is fine

interface CachedCover { query: string; cover: string | null; fetched_at: string }

export function getCachedWebCover(query: string): string | null | undefined {
  const row = get<CachedCover>('SELECT query, cover, fetched_at FROM web_cover_cache WHERE query = ?', query);
  if (!row) return undefined;
  if (row.cover === null) {
    // Negative results are re-checked after an hour, so a temporarily offline
    // service can recover without a manual reset.
    const age = Date.now() - new Date(row.fetched_at).getTime();
    if (age < 60 * 60 * 1000) return null;
    return undefined;
  }
  const age = Date.now() - new Date(row.fetched_at).getTime();
  if (age < CACHE_TTL_MS) return row.cover;
  return undefined;
}

function cacheCover(query: string, cover: string | null): void {
  run(
    `INSERT INTO web_cover_cache (query, cover, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(query) DO UPDATE SET cover = excluded.cover, fetched_at = excluded.fetched_at`,
    query, cover, new Date().toISOString()
  );
}

async function wikipediaCover(query: string): Promise<string | null> {
  const res = await outboundFetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}?redirect=true`,
    { headers: { 'Accept': 'application/json' }, timeoutMs: 6000 }
  );
  if (!res.ok) return null;
  const data = await res.json() as { thumbnail?: { source?: string } };
  return data.thumbnail?.source ?? null;
}

async function searxngCover(query: string): Promise<string | null> {
  const base = process.env.SEARXNG_URL;
  if (!base) return null;
  const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=images`;
  const res = await outboundFetch(url, {
    headers: { 'User-Agent': 'VirtuallyView/1.0' },
    timeoutMs: 6000
  });
  if (!res.ok) return null;
  const data = await res.json() as { results?: Array<{ img_src?: string; thumbnail_src?: string }> };
  return data.results?.find(r => r.img_src || r.thumbnail_src)?.img_src ??
    data.results?.find(r => r.thumbnail_src)?.thumbnail_src ?? null;
}

async function duckduckgoCover(query: string): Promise<string | null> {
  const res = await outboundFetch(`https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&o=json&s=0`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Referer': 'https://duckduckgo.com/'
    },
    timeoutMs: 6000
  });
  if (!res.ok) return null;
  const data = await res.json() as { results?: Array<{ image?: string }> };
  return data.results?.find(r => r.image)?.image ?? null;
}

async function bingCover(query: string): Promise<string | null> {
  const res = await outboundFetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&format=rss`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
    timeoutMs: 6000
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const match = /<murl>([^<]+)<\/murl>/.exec(xml) ?? /<link>([^<]+)<\/link>/.exec(xml);
  return match?.[1] ?? null;
}

/**
 * Returns a stable web cover for a media query. Tries each source in order and
 * caches the winner (including a short-lived negative cache) server-side.
 */
export async function fetchWebCover(query: string): Promise<string | null> {
  const cleaned = query.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  const cached = getCachedWebCover(cleaned);
  if (cached !== undefined) return cached;

  const sources: Array<() => Promise<string | null>> = [
    () => wikipediaCover(cleaned),
    () => searxngCover(cleaned),
    () => duckduckgoCover(cleaned),
    () => bingCover(cleaned)
  ];
  for (const source of sources) {
    try {
      const url = await source();
      if (url) {
        cacheCover(cleaned, url);
        return url;
      }
    } catch {
      // try the next source; a down service should not block the search
    }
  }
  cacheCover(cleaned, null);
  return null;
}