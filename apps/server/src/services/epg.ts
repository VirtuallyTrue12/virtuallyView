import { gunzipSync } from 'node:zlib';
import { outboundFetch } from './outbound.js';

/**
 * Program guide for Live TV, from ordinary XMLTV files. A guide is read once, kept for a few hours,
 * and only the programmes that matter (a day-and-a-half window, for channels that exist) are kept.
 */
export interface Programme { start: number; stop: number; title: string; desc?: string }

const TTL_MS = 3 * 3_600_000;
const MAX_BYTES = 120 * 1024 * 1024;
const cache = new Map<string, { at: number; byChannel: Map<string, Programme[]> }>();
const loading = new Map<string, Promise<void>>();
export const clearGuideCache = (): void => { cache.clear(); loading.clear(); };

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

/** Programmes inside [from, to] for the wanted channel ids, sorted by start. */
export function parseXmltv(xml: string, wanted: Set<string>, from: number, to: number): Map<string, Programme[]> {
  const out = new Map<string, Programme[]>();
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const channel = attr(m[1]!, 'channel');
    if (!channel || !wanted.has(channel)) continue;
    const start = xmltvTime(attr(m[1]!, 'start'));
    const stop = xmltvTime(attr(m[1]!, 'stop'));
    if (start === null || stop === null || stop <= from || start >= to) continue;
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[2]!)?.[1];
    if (!title) continue;
    const desc = /<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]!)?.[1];
    const list = out.get(channel) ?? [];
    list.push({ start, stop, title: decode(title).slice(0, 160), ...(desc ? { desc: decode(desc).slice(0, 400) } : {}) });
    out.set(channel, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start);
  return out;
}

async function load(url: string, wanted: Set<string>): Promise<void> {
  const res = await outboundFetch(url, { timeoutMs: 60_000 });
  if (!res.ok) throw new Error(`The guide answered ${res.status}.`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('The guide file is too large.');
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: MAX_BYTES * 2 });
  const now = Date.now();
  cache.set(url, { at: now, byChannel: parseXmltv(buf.toString('utf8'), wanted, now - 3 * 3_600_000, now + 36 * 3_600_000) });
}

/**
 * Read a guide in the background. Returns true when it is ready now; otherwise it keeps loading and the caller
 * asks again a few seconds later, so a slow multi-megabyte guide never holds a page open.
 */
export async function ensureGuide(url: string, wanted: Set<string>, waitMs = 6000): Promise<boolean> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return true;
  if (!loading.has(url)) loading.set(url, load(url, wanted).catch(() => { cache.set(url, { at: Date.now() - TTL_MS + 5 * 60_000, byChannel: new Map() }); }).finally(() => { loading.delete(url); }));
  await Promise.race([loading.get(url), new Promise(r => setTimeout(r, waitMs))]);
  return cache.has(url) && !loading.has(url);
}

export function programmesFor(url: string, tvgId: string, from: number, to: number): Programme[] {
  return (cache.get(url)?.byChannel.get(tvgId) ?? []).filter(p => p.stop > from && p.start < to);
}
