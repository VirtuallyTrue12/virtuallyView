import { gunzipSync } from 'node:zlib';
import { outboundFetch } from './outbound.js';

/**
 * Program guide for Live TV, from ordinary XMLTV files. A guide is read once, kept for a few hours,
 * and only the programmes that matter (a day-and-a-half window, for channels that exist) are kept.
 */
export interface Programme { start: number; stop: number; title: string; desc?: string }

const TTL_MS = 3 * 3_600_000;
const MAX_BYTES = 120 * 1024 * 1024;
const cache = new Map<string, { at: number; byChannel: Map<string, Programme[]>; byName: Map<string, string> }>();
const loading = new Map<string, Promise<void>>();

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();

/** "20260926120000 +0200" to milliseconds. */
export function xmltvTime(text: string | undefined): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec((text ?? '').trim());
  if (!m) return null;
  const utc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  const off = m[7] ? (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(3, 5)) * 60_000 : 0;
  return utc - off;
}

const attr = (attrs: string, key: string) => new RegExp(`\\b${key}="([^"]*)"`).exec(attrs)?.[1];

/** "Colors HD", "Colors TV (1080p)" and "COLORS" all become "colors", so guides and playlists find each other. */
export function nameKey(name: string): string {
  const tidy = name.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(hd|sd|fhd|uhd|4k|1080p|720p|tv|channel|india|uk|usa|us)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
  // "&TV" would tidy away to nothing: keep its letters as they are.
  return tidy.length >= 2 ? tidy : name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

/** The channels a guide lists, by tidied name, for playlists whose ids do not match the guide's. */
export function guideNames(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const id = attr(m[1]!, 'id');
    if (!id) continue;
    for (const d of m[2]!.matchAll(/<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g)) {
      const key = nameKey(decode(d[1]!));
      if (key && !out.has(key)) out.set(key, id);
    }
  }
  return out;
}

/** Programmes inside [from, to] for the wanted channel ids, sorted by start. */
export function parseXmltv(xml: string, wanted: Set<string> | null, from: number, to: number): Map<string, Programme[]> {
  const out = new Map<string, Programme[]>();
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const channel = attr(m[1]!, 'channel');
    if (!channel || (wanted && !wanted.has(channel))) continue;
    const start = xmltvTime(attr(m[1]!, 'start'));
    const stop = xmltvTime(attr(m[1]!, 'stop'));
    if (start === null || stop === null || stop <= from || start >= to) continue;
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[2]!)?.[1];
    // Some guides pad gaps with placeholder entries; they carry no information.
    if (!title || /^\s*(no data|no information|no programme information|to be announced)\s*$/i.test(decode(title))) continue;
    const desc = /<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]!)?.[1];
    const list = out.get(channel) ?? [];
    list.push({ start, stop, title: decode(title).slice(0, 160), ...(desc ? { desc: decode(desc).slice(0, 400) } : {}) });
    out.set(channel, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start);
  return out;
}

async function load(url: string, wanted: Set<string> | null): Promise<void> {
  const res = await outboundFetch(url, { timeoutMs: 60_000 });
  if (!res.ok) throw new Error(`The guide answered ${res.status}.`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('The guide file is too large.');
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: MAX_BYTES * 2 });
  const now = Date.now();
  const xml = buf.toString('utf8');
  cache.set(url, { at: now, byChannel: parseXmltv(xml, wanted, now - 3 * 3_600_000, now + 36 * 3_600_000), byName: wanted ? new Map() : guideNames(xml) });
}

/**
 * Read a guide in the background. Returns true when it is ready now; otherwise it keeps loading and the caller
 * asks again a few seconds later, so a slow multi-megabyte guide never holds a page open.
 */
export async function ensureGuide(url: string, wanted: Set<string> | null, waitMs = 6000): Promise<boolean> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return true;
  if (!loading.has(url)) loading.set(url, load(url, wanted).catch(() => { cache.set(url, { at: Date.now() - TTL_MS + 5 * 60_000, byChannel: new Map(), byName: new Map() }); }).finally(() => { loading.delete(url); }));
  await Promise.race([loading.get(url), new Promise(r => setTimeout(r, waitMs))]);
  return cache.has(url) && !loading.has(url);
}

export function programmesFor(url: string, tvgId: string, from: number, to: number, name?: string): Programme[] {
  const entry = cache.get(url);
  const id = entry?.byChannel.has(tvgId) ? tvgId : name ? entry?.byName.get(nameKey(name)) : undefined;
  return (id ? entry?.byChannel.get(id) ?? [] : []).filter(p => p.stop > from && p.start < to);
}

// A free, community-run guide by country, for playlists that come without one (the iptv-org lists).
const FALLBACK_COUNTRIES = new Set(['in', 'uk', 'us', 'ca', 'au', 'nz', 'ie', 'de', 'fr', 'es', 'it', 'nl', 'be', 'pt', 'br', 'mx', 'ar', 'za', 'ae', 'sa', 'pk', 'bd', 'lk', 'np', 'sg', 'my', 'ph', 'id', 'jp', 'kr', 'tr', 'pl', 'se', 'no', 'dk', 'fi', 'gr', 'ro', 'ch', 'at']);
/** The fallback guide for a channel, from the country in its id ("ZeeTV.in"), or null. */
export function fallbackGuide(tvgId: string | undefined): string | null {
  const cc = /\.([a-z]{2})$/i.exec(tvgId ?? '')?.[1]?.toLowerCase();
  return cc && FALLBACK_COUNTRIES.has(cc) ? `https://epgshare01.online/epgshare01/epg_ripper_${cc.toUpperCase()}1.xml.gz` : null;
}
