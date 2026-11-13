import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../lib/paths.js';
import { booksRoot } from '../library-folders.js';
import { readEpub, type EpubMeta } from './epub.js';

// The book library: every book and audiobook under /media/books, with details read from the files themselves
// (EPUB package data, a metadata.json written by Pull, or the folder names). Covers and parsed details are
// cached in the data folder; a rescan is a cheap directory walk, and only new or changed files are re-read.

export const EBOOK_EXT = ['epub', 'pdf', 'mobi', 'azw3', 'cbz', 'cbr', 'txt'] as const;
export const AUDIO_EXT = ['mp3', 'm4b', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav'] as const;
const EBOOK_RE = new RegExp(`\\.(${EBOOK_EXT.join('|')})$`, 'i');
const AUDIO_RE = new RegExp(`\\.(${AUDIO_EXT.join('|')})$`, 'i');
export const MIME: Record<string, string> = {
  epub: 'application/epub+zip', pdf: 'application/pdf', mobi: 'application/x-mobipocket-ebook', azw3: 'application/vnd.amazon.ebook',
  cbz: 'application/vnd.comicbook+zip', cbr: 'application/vnd.comicbook-rar', txt: 'text/plain; charset=utf-8',
  mp3: 'audio/mpeg', m4b: 'audio/mp4', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav'
};
const PREFERRED = ['epub', 'pdf', 'azw3', 'mobi', 'cbz', 'cbr', 'txt'];
const MAX_FILES = 20_000, MAX_DEPTH = 8, RESCAN_MS = 10_000;

export interface BookFile { index: number; name: string; size: number; format: string; mime: string }
export interface BookItem {
  id: string; kind: 'ebook' | 'audiobook'; title: string; authors: string[]; year?: number; language?: string; subjects: string[]; description?: string;
  hasCover: boolean; /** Milliseconds since 1970 when the newest file arrived. */ addedAt: number;
  /** Ebooks: one entry per format of the same book (best first). Audiobooks: the tracks in order. */ files: BookFile[];
  /** Where it came from when it was pulled (gutenberg, archive, arxiv, librivox, indexers). */ source?: string; sourceId?: string;
  /** Library path of the file (ebooks) or folder (audiobooks); also the key favourites use. */ path: string;
}
interface Rec extends BookItem { rels: string[]; coverRel?: string }

const dataDir = () => path.resolve(DATA_DIR, 'books');
const coversDir = () => path.join(dataDir(), 'covers');
const metaCacheFile = () => path.join(dataDir(), 'meta-cache.json');
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const extOf = (f: string) => path.extname(f).slice(1).toLowerCase();

/** One path segment safe on every file system: no slashes, dots-only names, control characters or trailing dots. */
export function sanitizeSegment(raw: string, fallback = 'Unknown', max = 90): string {
  const clean = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').replace(/(^|\s)\.+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, max).trim();
  return clean || fallback;
}

interface CacheEntry { meta: EpubMeta; coverExt?: string }
let metaCache: Record<string, CacheEntry> | null = null;
let metaDirty = false;
const loadMetaCache = () => {
  if (metaCache) return metaCache;
  try { metaCache = JSON.parse(readFileSync(metaCacheFile(), 'utf8')) as Record<string, CacheEntry>; } catch { metaCache = {}; }
  return metaCache;
};
function saveMetaCache(): void {
  if (!metaDirty || !metaCache) return;
  try {
    mkdirSync(dataDir(), { recursive: true });
    const tmp = `${metaCacheFile()}.tmp`;
    writeFileSync(tmp, JSON.stringify(metaCache));
    renameSync(tmp, metaCacheFile());
    metaDirty = false;
  } catch { /* the cache is only a speed-up */ }
}

interface Sidecar { source?: string; sourceId?: string; title?: string; authors?: string[]; year?: number; language?: string; subjects?: string[]; description?: string }
function readSidecar(dir: string): Sidecar | null {
  try { return JSON.parse(readFileSync(path.join(dir, 'metadata.json'), 'utf8')) as Sidecar; } catch { return null; }
}
const strings = (v: unknown, max = 40): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim()).slice(0, max) : []);

const tidy = (s: string) => s.replace(/[_]+/g, ' ').replace(/\s*\(\d{4}\)\s*$/, '').replace(/\s+/g, ' ').trim();

let records: Rec[] = [];
let scannedAt = 0;
let scannedRoot = '';

function scan(): Rec[] {
  const root = booksRoot();
  const found: Rec[] = [];
  let seen = 0;
  const cache = loadMetaCache();
  const walk = (rel: string, depth: number) => {
    if (depth > MAX_DEPTH || seen > MAX_FILES) return;
    const dirAbs = path.join(root, rel);
    let entries;
    try { entries = readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
    const ebooks = new Map<string, Array<{ name: string; size: number; mtime: number }>>();
    const audio: Array<{ name: string; size: number; mtime: number }> = [];
    let coverRel: string | undefined;
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) { walk(rel ? `${rel}/${e.name}` : e.name, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (/^(cover|folder|front)\.(jpe?g|png|webp)$/i.test(e.name)) coverRel = rel ? `${rel}/${e.name}` : e.name;
      const isBook = EBOOK_RE.test(e.name), isAudio = AUDIO_RE.test(e.name);
      if (!isBook && !isAudio) continue;
      seen++;
      let st;
      try { st = statSync(path.join(dirAbs, e.name)); } catch { continue; }
      const f = { name: e.name, size: st.size, mtime: st.mtimeMs };
      if (isAudio) audio.push(f);
      else { const stem = e.name.slice(0, e.name.lastIndexOf('.')).toLowerCase(); (ebooks.get(stem) ?? ebooks.set(stem, []).get(stem)!).push(f); }
    }
    if (!ebooks.size && !audio.length) return;
    const side = readSidecar(dirAbs);
    const parts = rel ? rel.split('/') : [];
    const sideFields = (fallbackTitle: string, folderAuthor?: string) => ({
      title: side?.title?.trim() || fallbackTitle,
      authors: strings(side?.authors).length ? strings(side?.authors) : folderAuthor ? [folderAuthor] : [],
      ...(typeof side?.year === 'number' ? { year: side.year } : {}),
      ...(side?.language ? { language: side.language } : {}), subjects: strings(side?.subjects, 30),
      ...(side?.description ? { description: side.description.slice(0, 4000) } : {}),
      ...(side?.source ? { source: String(side.source) } : {}), ...(side?.sourceId ? { sourceId: String(side.sourceId) } : {})
    });
    const yearOf = (s: string) => { const y = Number(/\((\d{4})\)\s*$/.exec(s)?.[1]); return y > 0 ? y : undefined; };
    for (const [stem, group] of ebooks) {
      group.sort((a, b) => PREFERRED.indexOf(extOf(a.name)) - PREFERRED.indexOf(extOf(b.name)));
      const rels = group.map(f => (rel ? `${rel}/${f.name}` : f.name));
      const id = sha(`b:${rel}/${stem}`);
      const folderAuthor = parts.length >= 2 ? parts[parts.length - 2] : undefined;
      const base = sideFields(tidy(group[0]!.name.slice(0, group[0]!.name.lastIndexOf('.'))), folderAuthor);
      const rec: Rec = { id, kind: 'ebook', ...base, hasCover: false, addedAt: Math.max(...group.map(f => f.mtime)), path: rels[0]!, rels,
        files: group.map((f, index) => ({ index, name: f.name, size: f.size, format: extOf(f.name), mime: MIME[extOf(f.name)] ?? 'application/octet-stream' })) };
      if (!rec.year) { const y = yearOf(parts[parts.length - 1] ?? ''); if (y) rec.year = y; }
      // Details written by Pull win; otherwise the first EPUB says what the book is.
      const epub = group.find(f => extOf(f.name) === 'epub');
      if (epub) {
        const key = `${rels[group.indexOf(epub)]}|${epub.size}|${Math.round(epub.mtime)}`;
        let hit = cache[key];
        if (!hit) {
          const parsed = readEpub(path.join(dirAbs, epub.name));
          hit = { meta: parsed?.meta ?? { authors: [], subjects: [] } };
          if (parsed?.cover) {
            const ext = parsed.cover.type.includes('png') ? 'png' : parsed.cover.type.includes('webp') ? 'webp' : 'jpg';
            try { mkdirSync(coversDir(), { recursive: true }); writeFileSync(path.join(coversDir(), `${id}.${ext}`), parsed.cover.bytes); hit.coverExt = ext; } catch { /* no cover */ }
          }
          hit.meta = { ...hit.meta, coverPath: undefined };
          cache[key] = hit; metaDirty = true;
        }
        const m = hit.meta;
        if (!side?.title && m.title) rec.title = m.title;
        if (!side?.authors?.length && m.authors.length) rec.authors = m.authors;
        if (!rec.language && m.language) rec.language = m.language;
        if (!rec.subjects.length) rec.subjects = m.subjects;
        if (!rec.description && m.description) rec.description = m.description;
        // Gutenberg's own EPUBs carry the date they were released there, not the book's year.
        if (!rec.year && m.year && side?.source !== 'gutenberg') rec.year = m.year;
        if (hit.coverExt && existsSync(path.join(coversDir(), `${id}.${hit.coverExt}`))) rec.hasCover = true;
      }
      if (!rec.hasCover && coverRel && ebooks.size === 1) { rec.coverRel = coverRel; rec.hasCover = true; }
      found.push(rec);
    }
    if (audio.length) {
      audio.sort((a, b) => collator.compare(a.name, b.name));
      const rels = audio.map(f => (rel ? `${rel}/${f.name}` : f.name));
      const folder = parts[parts.length - 1] ?? 'Audiobook';
      const base = sideFields(tidy(folder), parts.length >= 2 ? parts[parts.length - 2] : undefined);
      const rec: Rec = { id: sha(`a:${rel}`), kind: 'audiobook', ...base, hasCover: !!coverRel, ...(coverRel ? { coverRel } : {}), addedAt: Math.max(...audio.map(f => f.mtime)), path: rel, rels,
        files: audio.map((f, index) => ({ index, name: f.name, size: f.size, format: extOf(f.name), mime: MIME[extOf(f.name)] ?? 'audio/mpeg' })) };
      if (!rec.year) { const y = yearOf(folder); if (y) rec.year = y; }
      found.push(rec);
    }
  };
  walk('', 0);
  saveMetaCache();
  return found.sort((a, b) => b.addedAt - a.addedAt);
}

/** The whole library, rescanned when it is more than a few seconds old (or `fresh`). */
export function libraryRecords(fresh = false): Rec[] {
  const now = Date.now();
  if (fresh || scannedRoot !== booksRoot() || now - scannedAt > RESCAN_MS) {
    try { records = scan(); } catch { records = []; }
    scannedAt = now; scannedRoot = booksRoot();
  }
  return records;
}

export const publicItem = ({ rels: _rels, coverRel: _cover, ...item }: Rec): BookItem => item;
export const findRecord = (id: string, fresh = false): Rec | undefined => libraryRecords(fresh).find(r => r.id === id);
export const invalidateLibrary = (): void => { scannedAt = 0; };

/** Absolute path of one of a book's files (an ebook format or an audiobook track), or null. */
export function fileOf(rec: Rec, index: number): { abs: string; file: BookFile } | null {
  const rel = rec.rels[index], file = rec.files[index];
  if (!rel || !file) return null;
  const root = path.resolve(booksRoot());
  const abs = path.resolve(root, rel);
  return abs.startsWith(`${root}${path.sep}`) ? { abs, file } : null;
}

/** Absolute path and type of a book's cover, or null. */
export function coverOf(rec: Rec): { abs: string; mime: string } | null {
  for (const ext of ['jpg', 'png', 'webp']) {
    const abs = path.join(coversDir(), `${rec.id}.${ext}`);
    if (existsSync(abs)) return { abs, mime: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
  }
  if (rec.coverRel) {
    const abs = path.join(booksRoot(), rec.coverRel);
    if (existsSync(abs)) return { abs, mime: `image/${extOf(abs) === 'jpg' ? 'jpeg' : extOf(abs)}` };
  }
  return null;
}

// ---- matching a search result against what is already on the shelf ----
export const normTitle = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const surname = (a: string) => normTitle(a.includes(',') ? a.split(',')[0]! : a.trim().split(/\s+/).pop() ?? a);

/** The id of a library book that is this title by this author (or was pulled from this very source id). */
export function matchLibrary(title: string, authors: string[], source?: string, sourceId?: string): string | undefined {
  const t = normTitle(title);
  return libraryRecords().find(r => {
    if (source && sourceId && r.source === source && r.sourceId === sourceId) return true;
    if (!t || normTitle(r.title) !== t) return false;
    return !authors.length || !r.authors.length || authors.some(a => r.authors.some(b => surname(a) === surname(b)));
  })?.id;
}

/** Test hook: forget everything cached in memory. */
export const resetLibraryCache = (): void => { records = []; scannedAt = 0; metaCache = null; metaDirty = false; };
