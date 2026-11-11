import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { outboundFetch } from './outbound.js';

/**
 * Channel pictures fetched by this server straight from YouTube's image hosts and kept on disk. The video
 * service's own /ggpht/ proxy refuses most of them (it only passes the older "ytc/" pictures), so cards showed
 * letters. Only these exact hosts, only raster images, only up to MAX_BYTES: never an open proxy.
 */
export const IMAGE_HOSTS = new Set(['yt3.ggpht.com', 'yt3.googleusercontent.com', 'i.ytimg.com']);
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
export const MAX_BYTES = 2_000_000;
const MAX_AGE_MS = 7 * 86_400_000;
const cacheDir = () => join(DATA_DIR, 'image-cache');

export const allowedImageUrl = (url: string): boolean => {
  try { const u = new URL(url); return u.protocol === 'https:' && IMAGE_HOSTS.has(u.hostname) && !u.username && !u.port; } catch { return false; }
};

/** Fetches an allowed image, following at most 3 redirects and only to allowed hosts. Null for anything else. */
export async function fetchImage(url: string): Promise<{ type: string; bytes: Buffer } | null> {
  for (let hop = 0; hop < 4; hop++) {
    if (!allowedImageUrl(url)) return null;
    const res = await outboundFetch(url, { headers: { 'User-Agent': 'virtuallyView' }, timeoutMs: 8000, redirect: 'manual' });
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) { url = new URL(next, url).toString(); continue; }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!res.ok || !TYPES[type] || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length && bytes.length <= MAX_BYTES ? { type, bytes } : null;
  }
  return null;
}

/** The image from the disk cache when fresh, else fetched and stored. A stale copy is still served when the fetch fails. */
export async function cachedImage(url: string): Promise<{ type: string; bytes: Buffer } | null> {
  if (!allowedImageUrl(url)) return null;
  const base = join(cacheDir(), createHash('sha256').update(url).digest('hex'));
  let stale: { type: string; bytes: Buffer } | null = null;
  for (const [type, ext] of Object.entries(TYPES)) {
    const file = `${base}.${ext}`;
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    const hit = { type, bytes: await readFile(file) };
    if (Date.now() - info.mtimeMs < MAX_AGE_MS) return hit;
    stale = hit;
  }
  const fresh = await fetchImage(url).catch(() => null);
  if (!fresh) return stale;
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(`${base}.${TYPES[fresh.type]}`, fresh.bytes).catch(() => undefined);
  return fresh;
}
