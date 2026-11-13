import { createHash } from 'node:crypto';
import { safeFetch } from '../radio.js';
import type { ProwlarrAdapter } from '@virtuallyview/integrations';
import { getAdapter, loadServiceConfig } from '../registry.js';
import { decodeXml } from './epub.js';
import { matchLibrary } from './index.js';

// Where books come from. Each source has a parser (pure, tested) and a search with its own short timeout and a cache.
// Only official public APIs and the person's own Prowlarr are used.

export type SourceId = 'gutenberg' | 'archive' | 'openlibrary' | 'arxiv' | 'librivox' | 'indexers';
export const SOURCES: Array<{ id: SourceId; label: string; what: string }> = [
  { id: 'gutenberg', label: 'Project Gutenberg', what: 'Public domain books (EPUB, text)' },
  { id: 'archive', label: 'Internet Archive', what: 'Old books and scans (EPUB, PDF)' },
  { id: 'openlibrary', label: 'Open Library', what: 'Free to read books held by the Internet Archive' },
  { id: 'arxiv', label: 'arXiv', what: 'Research papers (PDF)' },
  { id: 'librivox', label: 'LibriVox', what: 'Public domain audiobooks' },
  { id: 'indexers', label: 'Your indexers', what: 'Books and audiobooks from the sources you added to Prowlarr' }
];

export interface BookFormat { kind: 'epub' | 'pdf' | 'txt' | 'audio' | 'torrent'; size?: number; label?: string }
export interface BookResult {
  source: SourceId; id: string; title: string; authors: string[]; year?: number; language?: string; subjects?: string[]; description?: string;
  /** An image address on this server (/api/books/cover?u=...), never a third-party address. */
  cover?: string; formats: BookFormat[]; media: 'ebook' | 'audiobook' | 'paper'; seeders?: number; /** Audiobook length in seconds. */ durationSec?: number;
  /** Id of the matching book already in the library. */ inLibrary?: string;
}

const env = (name: string, fallback: string) => (process.env[name] ?? fallback).replace(/\/$/, '');
export const urls = {
  gutendex: () => env('VV_BOOKS_GUTENDEX', 'https://gutendex.com'),
  gutenberg: () => env('VV_BOOKS_GUTENBERG_SITE', 'https://www.gutenberg.org'),
  archive: () => env('VV_BOOKS_ARCHIVE', 'https://archive.org'),
  openlibrary: () => env('VV_BOOKS_OPENLIBRARY', 'https://openlibrary.org'),
  openlibraryCovers: () => env('VV_BOOKS_OPENLIBRARY_COVERS', 'https://covers.openlibrary.org'),
  arxiv: () => env('VV_BOOKS_ARXIV', 'https://export.arxiv.org'),
  arxivSite: () => env('VV_BOOKS_ARXIV_SITE', 'https://arxiv.org'),
  librivox: () => env('VV_BOOKS_LIBRIVOX', 'https://librivox.org')
};

export const coverProxy = (url: string | undefined): string | undefined => (url ? `/api/books/cover?u=${encodeURIComponent(url)}` : undefined);
const UA = { 'User-Agent': 'virtuallyView/0.4 (self-hosted book search)', Accept: 'application/json, application/atom+xml, */*' };

export async function getText(url: string, ms: number): Promise<{ status: number; text: string }> {
  const res = await safeFetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  return { status: res.status, text: await res.text() };
}
async function getJson<T>(url: string, ms: number): Promise<{ status: number; json: T | null }> {
  const { status, text } = await getText(url, ms);
  try { return { status, json: JSON.parse(text) as T }; } catch { return { status, json: null }; }
}

const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const plain = (s: unknown) => decodeXml(String(s ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const yearOf = (v: unknown): number | undefined => { const y = Number(/\d{4}/.exec(String(v ?? ''))?.[0]); return y >= 100 && y <= new Date().getFullYear() + 1 ? y : undefined; };

/** "Aurelius, Marcus" becomes "Marcus Aurelius"; life years and titles after the name ("Marcus Aurelius, Emperor of Rome, 121-180") are dropped. */
export function flipName(raw: string): string {
  const name = raw.replace(/[,\s(]*\d{3,4}\??\s*-\s*\d{0,4}\??\)?\s*$/, '').trim();
  const parts = name.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return name;
  return /\b(of|the|emperor|king|saint|jr|sr|inc|baron|count|sir)\b/i.test(parts[1]!) ? parts[0]! : `${parts[1]} ${parts[0]}`;
}

// ---------- Project Gutenberg (Gutendex) ----------
interface GutendexBook { id: number; title: string; authors?: Array<{ name: string }>; subjects?: string[]; bookshelves?: string[]; languages?: string[]; formats?: Record<string, string> }
export interface GutenbergBook extends BookResult { urls: { epub?: string; txt?: string; pdf?: string; cover?: string } }

export function parseGutendex(json: unknown): GutenbergBook[] {
  const results = (json as { results?: GutendexBook[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.filter(b => b && b.id && b.title).map(b => {
    const f = b.formats ?? {};
    const pick = (re: RegExp) => Object.entries(f).find(([k, v]) => re.test(k) && !/\.zip$/i.test(v))?.[1];
    const found = { epub: pick(/^application\/epub\+zip/), txt: pick(/^text\/plain/), pdf: pick(/^application\/pdf/), cover: pick(/^image\/jpeg/) };
    const formats: BookFormat[] = [];
    if (found.epub) formats.push({ kind: 'epub' });
    if (found.pdf) formats.push({ kind: 'pdf' });
    if (found.txt) formats.push({ kind: 'txt' });
    return {
      source: 'gutenberg' as const, id: String(b.id), title: plain(b.title), authors: (b.authors ?? []).map(a => flipName(a.name)),
      ...(b.languages?.[0] ? { language: b.languages[0] } : {}), subjects: [...new Set([...(b.subjects ?? []), ...(b.bookshelves ?? [])])].slice(0, 20),
      ...(coverProxy(found.cover) ? { cover: coverProxy(found.cover) } : {}), formats, media: 'ebook' as const, urls: found
    };
  }).filter(b => b.formats.length);
}

// Project Gutenberg's own catalog feed (OPDS), used when Gutendex is down or slow, which it often is.
const LANGS: Record<string, string> = { english: 'en', french: 'fr', german: 'de', spanish: 'es', italian: 'it', latin: 'la', greek: 'el', chinese: 'zh', finnish: 'fi', dutch: 'nl', portuguese: 'pt', swedish: 'sv', hungarian: 'hu', esperanto: 'eo' };
const gutenbergUrls = (id: string) => ({ epub: `${urls.gutenberg()}/ebooks/${id}.epub3.images`, txt: `${urls.gutenberg()}/ebooks/${id}.txt.utf-8`, cover: `${urls.gutenberg()}/cache/epub/${id}/pg${id}.cover.medium.jpg` });
const fromOpds = (id: string, title: string, authors: string[], extra: Partial<BookResult> = {}): GutenbergBook => {
  const u = gutenbergUrls(id);
  return { source: 'gutenberg', id, title, authors, subjects: [], cover: coverProxy(u.cover), formats: [{ kind: 'epub' }, { kind: 'txt' }], media: 'ebook', urls: u, ...extra };
};
const first = (re: RegExp, text: string) => plain(re.exec(text)?.[1]);
export function parseGutenbergSearchOpds(xml: string): GutenbergBook[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(m => {
    const e = m[1]!;
    const id = /\/ebooks\/(\d+)\.opds/.exec(e)?.[1];
    const title = first(/<title>([\s\S]*?)<\/title>/, e), by = first(/<content[^>]*>([\s\S]*?)<\/content>/, e);
    return id && title ? [fromOpds(id, title, by ? [by] : [])] : [];
  });
}
export function parseGutenbergBookOpds(xml: string, id: string): GutenbergBook | null {
  const e = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1] ?? '';
  const title = first(/<title>([\s\S]*?)<\/title>/, e);
  if (!title) return null;
  // The feed's date is when Gutenberg released it, not when it was written, so no year is taken from it.
  const lang = LANGS[first(/<p>Language:\s*([^<]+)<\/p>/, e).toLowerCase()];
  const summary = first(/<p>\s*Summary:\s*([\s\S]*?)<\/p>/, e).replace(/\(This is an automatically generated summary\.\)/, '').trim();
  return fromOpds(id, title, [...e.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map(a => flipName(plain(a[1]))), {
    subjects: [...e.matchAll(/<p>Subject:\s*([^<]+)<\/p>/g)].map(x => plain(x[1])).filter(Boolean),
    ...(lang ? { language: lang } : {}), ...(summary ? { description: summary.slice(0, 1500) } : {})
  });
}
/** Popular Gutenberg books, optionally on one topic and language: Gutendex, else the catalog feed (no language filter there). */
export async function listGutenberg(topic: string, language: string): Promise<BookResult[]> {
  try {
    const found = parseGutendex((await getJson(`${urls.gutendex()}/books/?languages=${encodeURIComponent(language)}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`, 6000)).json);
    if (found.length) return found;
  } catch { /* fall through */ }
  return parseGutenbergSearchOpds((await getText(`${urls.gutenberg()}/ebooks/search.opds/?sort_order=downloads${topic ? `&query=${encodeURIComponent(topic)}` : ''}`, 9000)).text);
}
async function searchGutenberg(q: string): Promise<BookResult[]> {
  try {
    const found = parseGutendex((await getJson(`${urls.gutendex()}/books/?search=${encodeURIComponent(q)}`, 6000)).json);
    if (found.length) return found.slice(0, LIMIT);
  } catch { /* fall through to the catalog feed */ }
  return parseGutenbergSearchOpds((await getText(`${urls.gutenberg()}/ebooks/search.opds/?query=${encodeURIComponent(q)}`, 9000)).text).slice(0, LIMIT);
}

// ---------- Internet Archive ----------
interface ArchiveDoc { identifier: string; title?: string; creator?: string | string[]; year?: string | number; date?: string; language?: string | string[]; subject?: string | string[]; description?: string | string[]; format?: string | string[] }
const archiveFormat = (formats: string[]): BookFormat[] => {
  const out: BookFormat[] = [];
  if (formats.some(f => /^epub$/i.test(f))) out.push({ kind: 'epub' });
  if (formats.some(f => /pdf/i.test(f) && !/encrypted/i.test(f))) out.push({ kind: 'pdf' });
  return out;
};
export function parseArchiveSearch(json: unknown): BookResult[] {
  const docs = (json as { response?: { docs?: ArchiveDoc[] } } | null)?.response?.docs;
  if (!Array.isArray(docs)) return [];
  return docs.filter(d => d?.identifier && d.title).map(d => ({
    source: 'archive' as const, id: d.identifier, title: plain(asArray(d.title)[0]), authors: asArray(d.creator).map(plain).filter(Boolean).map(flipName).slice(0, 4),
    ...(yearOf(d.year ?? d.date) ? { year: yearOf(d.year ?? d.date) } : {}), ...(asArray(d.language)[0] ? { language: String(asArray(d.language)[0]) } : {}),
    subjects: asArray(d.subject).map(plain).filter(Boolean).slice(0, 15), ...(d.description ? { description: plain(asArray(d.description)[0]).slice(0, 600) } : {}),
    cover: coverProxy(`${urls.archive()}/services/img/${encodeURIComponent(d.identifier)}`), formats: archiveFormat(asArray(d.format).map(String)), media: 'ebook' as const
  })).filter(r => r.formats.length);
}

export interface ArchiveDetails { title: string; authors: string[]; year?: number; language?: string; subjects: string[]; description?: string; restricted: boolean; files: Array<{ name: string; kind: 'epub' | 'pdf'; size: number }> }
export function parseArchiveMetadata(json: unknown): ArchiveDetails | null {
  const j = json as { metadata?: Record<string, unknown>; files?: Array<{ name?: string; format?: string; size?: string | number }> } | null;
  const m = j?.metadata;
  if (!m || !Array.isArray(j?.files)) return null;
  const files: ArchiveDetails['files'] = [];
  for (const f of j.files ?? []) {
    if (!f.name || /^_|\.(xml|sqlite|json|torrent)$/i.test(f.name)) continue;
    const fmt = String(f.format ?? '');
    const kind = /^epub$/i.test(fmt) ? 'epub' : /pdf/i.test(fmt) && !/encrypted|image container/i.test(fmt) ? 'pdf' : null;
    if (kind) files.push({ name: f.name, kind, size: Number(f.size ?? 0) });
  }
  return {
    title: plain(asArray(m.title as string | string[])[0]), authors: asArray(m.creator as string | string[]).map(plain).filter(Boolean).map(flipName).slice(0, 4),
    ...(yearOf(m.year ?? m.date) ? { year: yearOf(m.year ?? m.date) } : {}), ...(asArray(m.language as string | string[])[0] ? { language: String(asArray(m.language as string | string[])[0]) } : {}),
    subjects: asArray(m.subject as string | string[]).map(plain).filter(Boolean).slice(0, 30), ...(m.description ? { description: plain(asArray(m.description as string | string[]).join(' ')).slice(0, 4000) } : {}),
    restricted: String(m['access-restricted-item'] ?? '').toLowerCase() === 'true', files
  };
}

// ---------- Open Library ----------
interface OlDoc { key?: string; title?: string; author_name?: string[]; first_publish_year?: number; language?: string[]; subject?: string[]; cover_i?: number; ia?: string[]; ebook_access?: string }
export function parseOpenLibrary(json: unknown): BookResult[] {
  const docs = (json as { docs?: OlDoc[] } | null)?.docs;
  if (!Array.isArray(docs)) return [];
  return docs.filter(d => d?.title && d.ia?.length && d.ebook_access === 'public').map(d => ({
    source: 'openlibrary' as const, id: d.ia![0]!, title: plain(d.title), authors: (d.author_name ?? []).slice(0, 4),
    ...(d.first_publish_year ? { year: d.first_publish_year } : {}), ...(d.language?.[0] ? { language: d.language[0] } : {}), subjects: (d.subject ?? []).slice(0, 15),
    cover: coverProxy(d.cover_i ? `${urls.openlibraryCovers()}/b/id/${d.cover_i}-M.jpg` : `${urls.archive()}/services/img/${encodeURIComponent(d.ia![0]!)}`),
    formats: [{ kind: 'pdf' as const }, { kind: 'epub' as const }], media: 'ebook' as const
  }));
}

// ---------- arXiv ----------
export function parseArxiv(xml: string): BookResult[] {
  const out: BookResult[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const idUrl = /<id>\s*([^<]+?)\s*<\/id>/.exec(e)?.[1] ?? '';
    const id = /arxiv\.org\/abs\/(.+?)(?:v\d+)?$/.exec(idUrl)?.[1];
    const title = plain(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1]);
    if (!id || !title) continue;
    out.push({
      source: 'arxiv', id, title, authors: [...e.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map(a => plain(a[1])).slice(0, 8),
      ...(yearOf(/<published>([^<]+)</.exec(e)?.[1]) ? { year: yearOf(/<published>([^<]+)</.exec(e)?.[1]) } : {}),
      subjects: [...e.matchAll(/<category[^>]*term="([^"]+)"/g)].map(c => c[1]!).slice(0, 6), description: plain(/<summary>([\s\S]*?)<\/summary>/.exec(e)?.[1]).slice(0, 800),
      formats: [{ kind: 'pdf' }], media: 'paper'
    });
  }
  return out;
}

// ---------- LibriVox ----------
interface LvBook { id: string | number; title?: string; description?: string; language?: string; copyright_year?: string; url_zip_file?: string; totaltimesecs?: number | string; authors?: Array<{ first_name?: string; last_name?: string }>; genres?: Array<{ name?: string }> }
export interface LibrivoxBook extends BookResult { zipUrl?: string }
export function parseLibrivox(json: unknown): LibrivoxBook[] {
  const books = (json as { books?: LvBook[] } | null)?.books;
  if (!Array.isArray(books)) return [];
  return books.filter(b => b?.id && b.title).map(b => ({
    source: 'librivox' as const, id: String(b.id), title: plain(b.title), authors: (b.authors ?? []).map(a => `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim()).filter(Boolean),
    ...(yearOf(b.copyright_year) ? { year: yearOf(b.copyright_year) } : {}), ...(b.language ? { language: b.language } : {}), subjects: (b.genres ?? []).map(g => String(g.name ?? '')).filter(Boolean),
    ...(b.description ? { description: plain(b.description).slice(0, 1500) } : {}), formats: b.url_zip_file ? [{ kind: 'audio' as const }] : [], media: 'audiobook' as const,
    ...(Number(b.totaltimesecs) > 0 ? { durationSec: Number(b.totaltimesecs) } : {}), ...(b.url_zip_file ? { zipUrl: b.url_zip_file } : {})
  })).filter(b => b.formats.length);
}

// ---------- the person's own indexers (Prowlarr) ----------
export interface ReleaseRow { guid?: string; title?: string; indexer?: string; size?: number; seeders?: number; protocol?: string; downloadUrl?: string; magnetUrl?: string; categories?: Array<{ id?: number }> }
export interface Release { id: string; guid: string; title: string; indexer: string; size: number; seeders: number; downloadUrl: string; audio: boolean }
const words = (s: string) => normalizeWords(s).filter(w => w.length > 2);
const normalizeWords = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/** Torrent releases with someone sharing them and a title that is about the query, best seeded first, one per title. */
export function parseReleases(rows: unknown, query: string): Release[] {
  if (!Array.isArray(rows)) return [];
  const want = words(query);
  const seen = new Set<string>();
  return (rows as ReleaseRow[]).filter(r => r?.guid && r.title && r.protocol === 'torrent' && (r.seeders ?? 0) > 0 && (r.size ?? 0) > 0)
    .filter(r => { const t = new Set(words(r.title!)); return !want.length || want.filter(w => t.has(w)).length / want.length >= 0.6; })
    .sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))
    .filter(r => { const k = `${words(r.title!).join(' ')}|${Math.round((r.size ?? 0) / 1e6)}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 40)
    .map(r => ({ id: createHash('sha1').update(r.guid!).digest('hex').slice(0, 16), guid: r.guid!, title: r.title!.trim(), indexer: r.indexer ?? '', size: r.size!, seeders: r.seeders!,
      downloadUrl: r.magnetUrl || r.downloadUrl || r.guid!, audio: (r.categories ?? []).some(c => Math.floor(Number(c.id) / 1000) === 3) }));
}
const releaseCache = new Map<string, { at: number; release: Release }>();
export const releaseById = (id: string): Release | undefined => { const e = releaseCache.get(id); return e && Date.now() - e.at < 3_600_000 ? e.release : undefined; };
export const prowlarrConfig = (): { url: string; apiKey: string } | null => {
  const c = loadServiceConfig()['prowlarr'];
  return c && c.enabled !== false && c.url && c.apiKey ? { url: c.url.replace(/\/$/, ''), apiKey: c.apiKey } : null;
};
export const indexersAvailable = (): boolean => prowlarrConfig() !== null;

// Prowlarr waits for every indexer it is asked, so one that averages 38 s (it happens) makes every search that slow.
// Indexers that are switched off, being skipped after failures, or clocked as slow are left out of this interactive search.
let usable: { at: number; ids: number[] } | null = null;
async function usableIndexers(): Promise<number[]> {
  if (usable && Date.now() - usable.at < 5 * 60_000) return usable.ids;
  try {
    const prowlarr = getAdapter<ProwlarrAdapter>('prowlarr');
    const [all, slow] = await Promise.all([prowlarr.listIndexers(), prowlarr.slowIndexerIds()]);
    const ids = all.filter(i => i.enabled && !i.failingUntil && !slow.has(i.id) && i.protocol === 'torrent').map(i => i.id);
    usable = { at: Date.now(), ids };
    return ids;
  } catch { return []; }
}

async function searchIndexers(q: string): Promise<BookResult[]> {
  const cfg = prowlarrConfig();
  if (!cfg) throw new SourceError('not_configured', 'Prowlarr is not connected. Add it in Settings to search your own indexers.');
  const ids = (await usableIndexers()).map(id => `&indexerIds=${id}`).join('');
  const res = await fetch(`${cfg.url}/api/v1/search?query=${encodeURIComponent(q)}&type=search&limit=100&categories=7000&categories=3030${ids}`, { headers: { 'X-Api-Key': cfg.apiKey }, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`Prowlarr answered ${res.status}.`);
  const releases = parseReleases(await res.json(), q);
  for (const r of releases) releaseCache.set(r.id, { at: Date.now(), release: r });
  return releases.map(r => ({ source: 'indexers' as const, id: r.id, title: r.title, authors: [], formats: [{ kind: 'torrent' as const, size: r.size, label: r.indexer }], media: r.audio ? 'audiobook' as const : 'ebook' as const, seeders: r.seeders }));
}

export class SourceError extends Error { constructor(public code: string, message: string) { super(message); } }

// ---------- search ----------
const quote = (q: string) => q.replace(/["\\]/g, ' ').trim();
const LIMIT = 20;

const searches: Record<SourceId, { ms: number; run: (q: string) => Promise<BookResult[]> }> = {
  gutenberg: { ms: 16_000, run: searchGutenberg },
  archive: {
    ms: 14_000, run: async q => {
      const query = `(${quote(q)}) AND mediatype:texts AND NOT access-restricted-item:true AND (format:EPUB OR format:"Text PDF")`;
      const fields = ['identifier', 'title', 'creator', 'year', 'language', 'subject', 'description', 'format'].map(f => `fl[]=${f}`).join('&');
      return parseArchiveSearch((await getJson(`${urls.archive()}/advancedsearch.php?q=${encodeURIComponent(query)}&${fields}&sort[]=downloads+desc&rows=${LIMIT}&output=json`, 14_000)).json);
    }
  },
  openlibrary: { ms: 12_000, run: async q => parseOpenLibrary((await getJson(`${urls.openlibrary()}/search.json?q=${encodeURIComponent(q)}&has_fulltext=true&limit=${LIMIT * 2}&fields=key,title,author_name,first_publish_year,language,subject,cover_i,ia,ebook_access`, 12_000)).json).slice(0, LIMIT) },
  arxiv: {
    ms: 14_000, run: async q => {
      const terms = words(q).slice(0, 8).map(w => `all:${w}`).join('+AND+') || `all:${encodeURIComponent(q)}`;
      return parseArxiv((await getText(`${urls.arxiv()}/api/query?search_query=${terms}&max_results=${LIMIT}&sortBy=relevance`, 14_000)).text);
    }
  },
  librivox: {
    ms: 12_000, run: async q => {
      const feed = async (field: string, value: string) => parseLibrivox((await getJson(`${urls.librivox()}/api/feed/audiobooks?format=json&limit=${LIMIT}&${field}=${encodeURIComponent(value)}`, 12_000)).json);
      const [byTitle, byAuthor] = await Promise.all([feed('title', q), feed('author', q.split(/\s+/).pop() ?? q).catch(() => [])]);
      const seen = new Set<string>();
      return [...byTitle, ...byAuthor].filter(b => !seen.has(b.id) && !!seen.add(b.id)).slice(0, LIMIT);
    }
  },
  indexers: { ms: 50_000, run: searchIndexers }
};

const cache = new Map<string, { at: number; results: BookResult[] }>();
const CACHE_MS = 10 * 60_000;

export const isSource = (s: unknown): s is SourceId => typeof s === 'string' && s in searches;

/** One source's answer. Cached for ten minutes; a source that is down or slow throws (the caller reports it). */
export async function searchSource(source: SourceId, q: string): Promise<BookResult[]> {
  const key = `${source}|${q.toLowerCase()}`;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    const spec = searches[source];
    const results = await Promise.race([spec.run(q), new Promise<never>((_, no) => setTimeout(() => no(new SourceError('timeout', 'That source took too long to answer.')), spec.ms))]);
    hit = { at: Date.now(), results };
    cache.set(key, hit);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  // inLibrary is looked up fresh: a book pulled a minute ago should show as owned even from a cached answer.
  // Download addresses stay on the server: only a source and an id go back to the browser.
  return hit.results.map(r => { const { urls: _u, zipUrl: _z, ...pub } = r as BookResult & { urls?: unknown; zipUrl?: unknown }; const own = matchLibrary(pub.title, pub.authors, pub.source === 'openlibrary' ? 'archive' : pub.source, pub.id); return own ? { ...pub, inLibrary: own } : pub; });
}

// ---------- what Pull needs to know about one item ----------
export interface Resolved {
  title: string; authors: string[]; year?: number; language?: string; subjects: string[]; description?: string; coverUrl?: string;
  /** Direct file (epub, pdf, txt, audio zip), a torrent release, or nothing downloadable. */
  download?: { url: string; kind: BookFormat['kind']; size?: number }; release?: Release; problem?: string;
}

/** Looks one item up at its source again (never trusting an address from the browser). Null when it does not exist. */
export async function resolveItem(source: SourceId, id: string, kind: BookFormat['kind']): Promise<Resolved | null> {
  if (source === 'gutenberg') {
    if (!/^\d{1,9}$/.test(id)) return null;
    // The official catalog feed first (fast), Gutendex when it is not answering.
    let one: GutenbergBook | null | undefined;
    try { one = parseGutenbergBookOpds((await getText(`${urls.gutenberg()}/ebooks/${id}.opds`, 8000)).text, id); } catch { one = null; }
    if (!one) { try { const { json } = await getJson<unknown>(`${urls.gutendex()}/books/${id}`, 8000); one = json ? parseGutendex({ results: [json] })[0] : undefined; } catch { one = undefined; } }
    if (!one) return null;
    const url = kind === 'txt' ? one.urls.txt : kind === 'pdf' ? one.urls.pdf : one.urls.epub;
    return { title: one.title, authors: one.authors, ...(one.language ? { language: one.language } : {}), subjects: one.subjects ?? [], ...(one.urls.cover ? { coverUrl: one.urls.cover } : {}),
      ...(url ? { download: { url, kind: kind === 'txt' || kind === 'pdf' ? kind : 'epub' } } : { problem: `Project Gutenberg has no ${kind.toUpperCase()} of this book.` }) };
  }
  if (source === 'archive' || source === 'openlibrary') {
    const { json } = await getJson<unknown>(`${urls.archive()}/metadata/${encodeURIComponent(id)}`, 14_000);
    const d = parseArchiveMetadata(json);
    if (!d) return null;
    if (d.restricted) return { ...d, problem: 'This one can only be borrowed from the Internet Archive, not downloaded.' };
    const file = d.files.filter(f => f.kind === (kind === 'epub' ? 'epub' : 'pdf')).sort((a, b) => b.size - a.size)[0] ?? d.files.find(f => f.kind === 'pdf') ?? d.files[0];
    return { ...d, coverUrl: `${urls.archive()}/services/img/${encodeURIComponent(id)}`,
      ...(file ? { download: { url: `${urls.archive()}/download/${encodeURIComponent(id)}/${file.name.split('/').map(encodeURIComponent).join('/')}`, kind: file.kind, size: file.size } } : { problem: 'No EPUB or PDF file is available for this one.' }) };
  }
  if (source === 'arxiv') {
    const one = parseArxiv((await getText(`${urls.arxiv()}/api/query?id_list=${encodeURIComponent(id)}`, 14_000)).text)[0];
    return one ? { title: one.title, authors: one.authors, ...(one.year ? { year: one.year } : {}), subjects: one.subjects ?? [], ...(one.description ? { description: one.description } : {}), download: { url: `${urls.arxivSite()}/pdf/${id}`, kind: 'pdf' } } : null;
  }
  if (source === 'librivox') {
    const { json } = await getJson<unknown>(`${urls.librivox()}/api/feed/audiobooks?format=json&id=${encodeURIComponent(id)}`, 12_000);
    const one = parseLibrivox(json)[0];
    return one ? { title: one.title, authors: one.authors, ...(one.year ? { year: one.year } : {}), ...(one.language ? { language: one.language } : {}), subjects: one.subjects ?? [], ...(one.description ? { description: one.description } : {}), download: { url: one.zipUrl!, kind: 'audio' } } : null;
  }
  const release = releaseById(id);
  return release ? { title: release.title, authors: [], subjects: [], release } : null;
}
