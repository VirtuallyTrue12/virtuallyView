import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// A small zip reader (central directory + inflateRaw) so EPUB details can be read without a dependency.
// shortcut: no zip64 or encrypted entries, fine for books, upgrade if a >4 GB archive ever matters.
export interface ZipEntry { name: string; method: number; csize: number; usize: number; offset: number }

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const got = readSync(fd, buf, 0, length, position);
  return got < length ? buf.subarray(0, got) : buf;
}

/** Every entry of a zip file, or null when the file is not a readable zip. */
export function zipEntries(file: string): Map<string, ZipEntry> | null {
  let fd = -1;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 70_000);
    const tail = readAt(fd, size - tailLen, tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) return null;
    const count = tail.readUInt16LE(eocd + 10);
    const dirSize = tail.readUInt32LE(eocd + 12);
    const dirOffset = tail.readUInt32LE(eocd + 16);
    if (dirOffset + dirSize > size || dirSize > 32_000_000) return null;
    const dir = readAt(fd, dirOffset, dirSize);
    const entries = new Map<string, ZipEntry>();
    let p = 0;
    for (let i = 0; i < count && p + 46 <= dir.length; i++) {
      if (dir.readUInt32LE(p) !== 0x02014b50) break;
      const nameLen = dir.readUInt16LE(p + 28), extraLen = dir.readUInt16LE(p + 30), commentLen = dir.readUInt16LE(p + 32);
      const name = dir.toString('utf8', p + 46, p + 46 + nameLen);
      entries.set(name, { name, method: dir.readUInt16LE(p + 10), csize: dir.readUInt32LE(p + 20), usize: dir.readUInt32LE(p + 24), offset: dir.readUInt32LE(p + 42) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } catch { return null; } finally { if (fd >= 0) closeSync(fd); }
}

/** One entry's bytes (stored or deflated), or null. `maxBytes` guards against a zip bomb. */
export function zipRead(file: string, entry: ZipEntry, maxBytes = 20_000_000): Buffer | null {
  if (entry.usize > maxBytes) return null;
  let fd = -1;
  try {
    fd = openSync(file, 'r');
    const head = readAt(fd, entry.offset, 30);
    if (head.readUInt32LE(0) !== 0x04034b50) return null;
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = readAt(fd, start, entry.csize);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return inflateRawSync(raw, { maxOutputLength: maxBytes });
    return null;
  } catch { return null; } finally { if (fd >= 0) closeSync(fd); }
}

/** True for a real EPUB: a zip with META-INF/container.xml. */
export const looksLikeEpub = (file: string): boolean => !!zipEntries(file)?.has('META-INF/container.xml');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeXml = (s: string): string => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
// Descriptions are often escaped HTML (&lt;p&gt;), so tags are removed before and after decoding.
const strip = (s: string) => decodeXml(s.replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export interface EpubMeta { title?: string; authors: string[]; language?: string; subjects: string[]; description?: string; year?: number; coverPath?: string; coverType?: string }

function tags(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'gi');
  for (let m = re.exec(xml); m; m = re.exec(xml)) { const t = strip(m[1] ?? ''); if (t) out.push(t); }
  return out;
}
const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[1] ?? m[2]) : undefined;
};

/** Title, authors, language, subjects, description and cover location from an OPF package document. */
export function parseOpf(xml: string, opfPath = ''): EpubMeta {
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const items = [...xml.matchAll(/<item\s[^>]*>/gi)].map(m => m[0]);
  const coverMeta = [...xml.matchAll(/<meta\s[^>]*>/gi)].map(m => m[0]).find(t => attr(t, 'name') === 'cover');
  const cover = items.find(t => /cover-image/.test(attr(t, 'properties') ?? '')) ?? (coverMeta ? items.find(t => attr(t, 'id') === attr(coverMeta, 'content')) : undefined);
  const href = cover ? attr(cover, 'href') : undefined;
  const year = Number(/\d{4}/.exec(tags(xml, 'date')[0] ?? '')?.[0]);
  let coverPath: string | undefined;
  if (href) { try { coverPath = decodeURIComponent(dir + href); } catch { coverPath = dir + href; } }
  return {
    title: tags(xml, 'title')[0], authors: [...new Set(tags(xml, 'creator'))], language: tags(xml, 'language')[0],
    subjects: [...new Set(tags(xml, 'subject'))].slice(0, 30), description: tags(xml, 'description')[0]?.slice(0, 4000),
    ...(year > 0 ? { year } : {}),
    ...(coverPath ? { coverPath, coverType: cover ? attr(cover, 'media-type') : undefined } : {})
  };
}

/** Everything the index needs from one EPUB, plus the cover image bytes. Null when it is not an EPUB. */
export function readEpub(file: string): { meta: EpubMeta; cover?: { bytes: Buffer; type: string } } | null {
  const entries = zipEntries(file);
  const container = entries?.get('META-INF/container.xml');
  if (!entries || !container) return null;
  const xml = zipRead(file, container, 200_000)?.toString('utf8') ?? '';
  const opfPath = /full-path\s*=\s*["']([^"']+)["']/i.exec(xml)?.[1];
  const opfEntry = opfPath ? entries.get(opfPath) : undefined;
  if (!opfPath || !opfEntry) return { meta: { authors: [], subjects: [] } };
  const meta = parseOpf(zipRead(file, opfEntry, 2_000_000)?.toString('utf8') ?? '', opfPath);
  const coverEntry = meta.coverPath ? entries.get(meta.coverPath) : undefined;
  const bytes = coverEntry ? zipRead(file, coverEntry, 6_000_000) : null;
  if (!bytes || !meta.coverPath) return { meta };
  const type = meta.coverType && /^image\//.test(meta.coverType) ? meta.coverType : /\.png$/i.test(meta.coverPath) ? 'image/png' : 'image/jpeg';
  return { meta, cover: { bytes, type } };
}
