import { get, all, run } from '../db/app-db.js';
import { outboundFetch } from './outbound.js';

export interface CastMember {
  name: string;
  role: string;
  /** Absolute TMDB profile image URL, or '' when the profile has no photo. */
  photo?: string;
}

export interface CastResult {
  mediaId: string;
  title: string;
  cast: CastMember[];
  source: 'cache' | 'tmdb' | 'shared' | 'none';
  fetchedAt?: string;
}

const CAST_SCHEMA = 3;
const TMDB_MOVIE_PAGE = 'https://www.themoviedb.org/movie/';
const TMDB_SEARCH_PAGE = 'https://www.themoviedb.org/search?query=';
// Force the English site: the default page can render actor names transliterated
// into the viewer's local script (e.g. Devanagari), which is what made the cast
// list show Hindi names on an English dashboard.
const TMDB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) VirtuallyView/1.0',
  'Accept-Language': 'en-US,en;q=0.9'
};

function absoluteImage(src: string): string {
  return src.startsWith('http') ? src : `https://image.tmdb.org${src}`;
}

/**
 * Find the profile image belonging to a cast card. TMDB puts the <img> just
 * before the person link inside the same card, so prefer the nearest preceding
 * image and fall back to one just after the link. Modern pages serve full
 * protocol URLs (`https://media.themoviedb.org/t/p/...`), older ones used a
 * relative `/t/p/...` path, so both are matched.
 */
function extractCastPhoto(html: string, anchorIndex: number): string {
  const before = html.slice(Math.max(0, anchorIndex - 900), anchorIndex);
  const preceding = [...before.matchAll(/(?:src|data-src)="([^"]*\/t\/p\/[^"]+)"/g)];
  if (preceding.length) return absoluteImage(preceding[preceding.length - 1][1].replace(/\?.*$/, ''));
  const after = html.slice(anchorIndex, anchorIndex + 900);
  const following = /(?:src|data-src)="([^"]*\/t\/p\/[^"]+)"/.exec(after);
  return following ? absoluteImage(following[1].replace(/\?.*$/, '')) : '';
}

/**
 * Only the cast list (not the crew list above it, which shares the same card
 * markup) has profile photos and character names for the actors. Restrict
 * parsing to the cast region: the scroller on the main page, or the "Cast"
 * section on the full credits page.
 */
function castRegion(html: string): string {
  const scroller = html.indexOf('id="cast_scroller"');
  if (scroller !== -1) {
    const end = html.indexOf('</ol>', scroller);
    if (end !== -1) return html.slice(scroller, end);
  }
  const castHeading = html.indexOf('<h3>Cast');
  if (castHeading !== -1) {
    const ol = html.indexOf('<ol', castHeading);
    if (ol !== -1) {
      const end = html.indexOf('</ol>', ol);
      if (end !== -1) return html.slice(castHeading, end);
    }
  }
  return html;
}

/** Extract cast names + character names from a TMDB movie page's HTML. */
function parseCastHtml(html: string, limit = 18): CastMember[] {
  const members: CastMember[] = [];
  const seen = new Set<string>();
  // TMDB renders each actor as `<p><a href="/person/…">Name</a></p>` followed
  // by `<p class="character">Role</p>` inside `<ol class="people">`. The crew
  // section uses the same cards, so only the cast region is scanned.
  const region = castRegion(html);
  const personRe = /<a[^>]+href="\/person\/(\d+)[^"]*"[^>]*>([^<]+)<\/a>/g;
  let m: RegExpExecArray | null;
  const persons: Array<{ name: string; after: string; photo: string }> = [];
  while ((m = personRe.exec(region)) !== null && persons.length < 40) {
    persons.push({
      name: m[2].trim(),
      after: region.slice(m.index + m[0].length, m.index + m[0].length + 320),
      photo: extractCastPhoto(region, m.index)
    });
  }
  // A cast member's character is rendered inside the same card as
  // `<p class="character">Role</p>` or, in older markup, "as <span>Role</span>".
  for (const person of persons) {
    if (!person.name) continue;
    const asMatch = /class="character"[^>]*>\s*([^<]+)\s*</i.exec(person.after)
      ?? /as\s+<[^>]*>([^<]+)<\/[^>]+>/i.exec(person.after)
      ?? /as\s+([A-Za-z0-9 ''.,-]+)</i.exec(person.after);
    const role = asMatch?.[1]?.trim() ?? '';
    const key = person.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    members.push({ name: person.name, role, photo: person.photo });
    if (members.length >= limit) break;
  }
  return members;
}

const slugify = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Resolve a TMDB movie id from a title search page. A candidate is only
 * accepted when its slug matches the requested title; taking "the first
 * result" is what used to attach another film's cast to the page.
 */
async function findTmdbId(title: string, year?: number): Promise<string | null> {
  const res = await outboundFetch(`${TMDB_SEARCH_PAGE}${encodeURIComponent(title)}&language=en-US`, {
    headers: TMDB_HEADERS,
    timeoutMs: 12000
  });
  if (!res.ok) return null;
  const html = await res.text();
  const wanted = slugify(title);
  const re = /href="\/movie\/(\d+)-([^"?\/]*)[^"]*"/g;
  let m: RegExpExecArray | null;
  const candidates: Array<{ id: string; slug: string; snippet: string }> = [];
  const seenIds = new Set<string>();
  while ((m = re.exec(html)) !== null && candidates.length < 20) {
    if (seenIds.has(m[1])) continue;
    seenIds.add(m[1]);
    candidates.push({ id: m[1], slug: m[2], snippet: html.slice(m.index, m.index + 600).toLowerCase() });
  }
  const exact = candidates.filter(c => c.slug === wanted);
  const near = candidates.filter(c => c.slug.startsWith(wanted));
  const pool = exact.length ? exact : near;
  if (!pool.length) return null;
  if (year) {
    const withYear = pool.find(c => c.snippet.includes(String(year)));
    if (withYear) return withYear.id;
  }
  return pool[0].id;
}

export async function scrapeCastForMedia(
  mediaId: string,
  title: string,
  year?: number,
  tmdbId?: number | string
): Promise<CastResult> {
  const cached = getCastCache(mediaId);
  if (cached) return { mediaId, title, cast: cached.cast, source: 'cache', fetchedAt: cached.fetchedAt };

  // TMDB ids from the *arr providers are the strongest key; otherwise resolve
  // by title search, which is still local-only.
  let pageId: string | null = tmdbId ? String(tmdbId) : null;
  if (!pageId && title) {
    try {
      pageId = await findTmdbId(title, year);
    } catch {
      pageId = null;
    }
  }
  if (!pageId) return { mediaId, title, cast: [], source: 'none' };

  try {
    const res = await outboundFetch(`${TMDB_MOVIE_PAGE}${pageId}?language=en-US`, {
      headers: TMDB_HEADERS,
      timeoutMs: 12000
    });
    if (!res.ok) return { mediaId, title, cast: [], source: 'none' };
    const html = await res.text();
    // The full cast is on /movie/{id}/cast; fall back to the main page's
    // "Top Billed Cast" section which lists the same people.
    const fromMain = parseCastHtml(html, 16);
    let cast = fromMain;
    if (!fromMain.length) {
      const res2 = await outboundFetch(`${TMDB_MOVIE_PAGE}${pageId}/cast?language=en-US`, {
        headers: TMDB_HEADERS,
        timeoutMs: 12000
      });
      if (res2.ok) {
        cast = parseCastHtml(await res2.text(), 18);
      }
    }
    if (!cast.length) {
      // Even with no cast, cache an empty result so we never hammer TMDB for
      // the same title on every visit.
      setCastCache(mediaId, [], 'tmdb');
      return { mediaId, title, cast: [], source: 'tmdb' };
    }
    cast = fillPhotosFromCache(cast);
    setCastCache(mediaId, cast, 'tmdb');
    return { mediaId, title, cast, source: 'tmdb' };
  } catch {
    return { mediaId, title, cast: [], source: 'none' };
  }
}

/**
 * Actor portraits are person data, not movie data: when a cast member has no
 * photo, reuse the portrait any other cached movie already found for that
 * actor. The cast LIST itself is never borrowed from another film.
 */
function fillPhotosFromCache(cast: CastMember[]): CastMember[] {
  if (cast.every(member => member.photo)) return cast;
  const known = new Map<string, string>();
  for (const row of all<{ payload: string }>('SELECT payload FROM cast_cache')) {
    try {
      const parsed = JSON.parse(row.payload) as { schema?: number; cast?: CastMember[] };
      if (parsed.schema !== CAST_SCHEMA || !Array.isArray(parsed.cast)) continue;
      for (const member of parsed.cast) {
        if (member.photo) known.set(member.name.toLowerCase(), member.photo);
      }
    } catch { /* skip unreadable row */ }
  }
  return cast.map(member => member.photo ? member : { ...member, photo: known.get(member.name.toLowerCase()) ?? '' });
}

export function getCastCache(mediaId: string): { cast: CastMember[]; fetchedAt: string } | null {
  const row = get<{ media_id: string; payload: string; fetched_at: string }>(
    'SELECT media_id, payload, fetched_at FROM cast_cache WHERE media_id = ?',
    mediaId
  );
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload) as { schema?: number; cast?: CastMember[] };
    // Legacy entries were stored as a bare cast array and predate profile
    // photos; treat them as stale so the next visit re-fetches once with the
    // English-names + portraits parser.
    if (!Array.isArray(parsed.cast) || parsed.schema !== CAST_SCHEMA) return null;
    return { cast: parsed.cast, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

function setCastCache(mediaId: string, cast: CastMember[], source: string): void {
  run(
    `INSERT INTO cast_cache (media_id, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    mediaId,
    JSON.stringify({ schema: CAST_SCHEMA, cast: cast.filter(c => c.name) }),
    new Date().toISOString()
  );
  void source;
}

/** Open a route to enrich a media item's cast on demand. */
export async function ensureCast(
  mediaId: string,
  title: string,
  year?: number,
  tmdbId?: number | string
): Promise<CastResult> {
  const existing = getCastCache(mediaId);
  if (existing?.cast.length) return { mediaId, title, cast: existing.cast, source: 'cache', fetchedAt: existing.fetchedAt };
  return scrapeCastForMedia(mediaId, title, year, tmdbId);
}