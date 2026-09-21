const TMDB_PAGE = 'https://www.themoviedb.org/movie/';
const ART = 'https://image.tmdb.org/t/p/w500';
const ART_LARGE = 'https://image.tmdb.org/t/p/w1280';

import { outboundFetch } from './outbound.js';

interface TmdbScrape {
  poster: string;
  backdrop: string;
  description?: string;
  trailerYouTubeId?: string;
  genres?: string[];
  runtime?: number;
  rating?: number;
}

const cache = new Map<string, TmdbScrape>();

function pick(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m ? m[1] : undefined;
}

function titleCase(value?: string): string {
  return (value ?? '')
    .split(' ')
    .map(w => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function cleanSlug(title: string, year?: number): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}${year ? '-' + year : ''}`;
}

// Prefer a deterministic local mapping so we never hit TMDB hot paths,
// falling back to live scraping only when a movie lacks scraped fields.
export async function scrapeMovie(tmdbId?: number | string, title?: string, year?: number): Promise<Partial<TmdbScrape>> {
  if (!tmdbId && !title) return {};

  const key = String(tmdbId ?? `${title ?? ''}-${year ?? ''}`);
  const cached = cache.get(key);
  if (cached) return cached;

  const pageId = tmdbId
    ? String(tmdbId)
    : `${cleanSlug(title ?? '')}-${year ?? ''}`;

  try {
    const res = await outboundFetch(`${TMDB_PAGE}${pageId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) VirtuallyView/1.0' },
      timeoutMs: 12000
    });
    if (!res.ok) return {};

    const html = await res.text();

    const posterPath =
      pick(html, /https:\/\/media\.themoviedb\.org\/t\/p\/w300_and_h450_face\/([A-Za-z0-9]+\.jpg)/) ??
      pick(html, /https:\/\/media\.themoviedb\.org\/t\/p\/w500\/([A-Za-z0-9]+\.jpg)/);

    const backdropPath =
      pick(html, /w1920_and_h800_multi_faces\/([A-Za-z0-9]+\.jpg)/) ??
      pick(html, /w1280\/([A-Za-z0-9]+\.jpg)/);

    const trailerYouTubeId = pick(html, /data-site="YouTube" data-id="([A-Za-z0-9_-]+)"/);
    const overview = pick(
      html,
      /<div class="overview"[^>]*>\s*<p>([\s\S]*?)<\/p>/s
    );

    const result: TmdbScrape = {
      poster: posterPath ? `${ART}/${posterPath}` : '',
      backdrop: backdropPath ? `${ART_LARGE}/${backdropPath}` : '',
      description: overview ? overview.replace(/\s+/g, ' ').trim() : undefined,
      trailerYouTubeId
    };

    cache.set(key, result);
    return result;
  } catch {
    return {};
  }
}

export function tmdbArt(poster?: string, backdrop?: string) {
  const posterUrl = poster?.startsWith('http') ? poster : poster ? `${ART}/${poster}` : '';
  const backdropUrl = backdrop?.startsWith('http') ? backdrop : backdrop ? `${ART_LARGE}/${backdrop}` : '';
  return { poster: posterUrl, backdrop: backdropUrl };
}

export function clearTmdbCache() {
  cache.clear();
}

export function tmdbCacheSize() {
  return cache.size;
}

export { titleCase };