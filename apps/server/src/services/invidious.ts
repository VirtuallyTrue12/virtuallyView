import { all, run } from '../db/app-db.js';
import { currentUserId } from './user-context.js';
import { outboundFetch } from './outbound.js';

/**
 * YouTube, through a private front end (Invidious) instead of YouTube itself: no ads, no account, no
 * Google seeing who is watching. `INVIDIOUS_URL` points at the bundled instance (docker compose --profile
 * invidious up -d) by default, or a public one you trust. Watch history stays only in this server's own
 * database; nothing about it is sent to Invidious or anywhere else.
 */

export interface VideoResult {
  id: string;
  title: string;
  channel: string;
  channelId?: string;
  durationSeconds: number;
  views: number;
  published?: string;
  thumbnail?: string;
  description?: string;
}

const clean = (value: unknown, max = 500): string => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');

function baseUrl(): string | null {
  const url = process.env.INVIDIOUS_URL?.trim();
  return url ? url.replace(/\/$/, '') : null;
}

/** The bundled instance, reached by its internal Docker name: local traffic, like the *arr services, never
 * the configured outbound (Tor/SOCKS5) proxy, which cannot reach it anyway. A public instance's own domain
 * is a real public-internet call, so it goes through that proxy when one is configured, same as any other
 * outbound lookup (Wikipedia, MusicBrainz, cover art). */
export function isBundledInstance(base: string): boolean {
  try { return new URL(base).hostname === 'invidious'; } catch { return false; }
}

/** A request to the configured instance, routed the same way `call` is: direct for the bundled instance,
 * through the configured outbound proxy for a public one. Exported so the thumbnail route (a raw image
 * fetch, not JSON) can follow the same rule instead of always going direct. */
export async function videoFetch(url: string, timeoutMs = 8000): Promise<Response> {
  const headers = { 'User-Agent': 'virtuallyView' };
  return isBundledInstance(url) ? fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) }) : outboundFetch(url, { headers, timeoutMs });
}

async function call<T>(path: string, timeoutMs = 8000): Promise<T> {
  const base = baseUrl();
  if (!base) throw new NotConfigured();
  const res = await videoFetch(`${base}${path}`, timeoutMs);
  if (!res.ok) throw new Error(`The video service answered ${res.status}.`);
  return res.json() as Promise<T>;
}

/** No INVIDIOUS_URL set: the Videos section, and the trailer lookup's use of it, are both quietly off. */
export class NotConfigured extends Error {
  constructor() { super('Videos needs a video service. Run: docker compose --profile invidious up -d (or set INVIDIOUS_URL to a public instance).'); }
}

export async function invidiousAvailable(): Promise<boolean> {
  try { await call('/api/v1/stats', 4000); return true; } catch { return false; }
}

interface RawVideo {
  videoId?: string; title?: string; author?: string; authorId?: string; lengthSeconds?: number; viewCount?: number;
  published?: number; videoThumbnails?: Array<{ url?: string; quality?: string; width?: number }>; description?: string;
}

function toResult(raw: RawVideo): VideoResult | null {
  const id = clean(raw.videoId, 20);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const thumb = (raw.videoThumbnails ?? []).find(t => t.quality === 'medium') ?? raw.videoThumbnails?.[0];
  return {
    id, title: clean(raw.title, 200) || 'Untitled video', channel: clean(raw.author, 120),
    ...(clean(raw.authorId, 40) ? { channelId: clean(raw.authorId, 40) } : {}),
    durationSeconds: Number.isFinite(raw.lengthSeconds) ? Math.max(0, raw.lengthSeconds as number) : 0,
    views: Number.isFinite(raw.viewCount) ? Math.max(0, raw.viewCount as number) : 0,
    ...(raw.published ? { published: new Date(raw.published * 1000).toISOString() } : {}),
    ...(thumb?.url ? { thumbnail: thumb.url } : {}),
    ...(raw.description ? { description: clean(raw.description, 2000) } : {})
  };
}

export async function searchVideos(query: string, page = 1): Promise<VideoResult[]> {
  const q = clean(query, 100);
  if (!q) return [];
  const rows = await call<RawVideo[]>(`/api/v1/search?q=${encodeURIComponent(q)}&type=video&page=${Math.max(1, Math.min(page, 20))}`);
  return rows.map(toResult).filter((v): v is VideoResult => !!v).slice(0, 30);
}

export async function videoInfo(id: string): Promise<VideoResult | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const raw = await call<RawVideo>(`/api/v1/videos/${id}?fields=videoId,title,author,authorId,lengthSeconds,viewCount,published,videoThumbnails,description`);
  return toResult(raw);
}

/** The address a real thumbnail image lives at through Invidious's own instance (proxied by this server, never fetched by the browser directly). */
export function thumbnailUpstream(id: string): string | null {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const base = baseUrl();
  return base ? `${base}/vi/${id}/mqdefault.jpg` : null;
}

/** Where the browser embeds the player (Invidious's own page draws the controls and pulls the stream itself).
 * `requestHost` is this request's own Host header: the bundled instance answers only to its internal Docker
 * name (`invidious`), which a browser cannot resolve, so its address becomes this server's own address on
 * the instance's published port instead. A public instance's own domain is already reachable directly. */
export function embedUrl(id: string, requestHost?: string): string | null {
  const base = baseUrl();
  if (!base || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  try {
    const parsed = new URL(base);
    if (parsed.hostname === 'invidious' && requestHost) {
      const host = requestHost.replace(/:\d+$/, '');
      const port = process.env.INVIDIOUS_EMBED_PORT ?? '3300';
      return `${parsed.protocol}//${host}:${port}/embed/${id}?local=true`;
    }
  } catch { /* an unparsable INVIDIOUS_URL falls through to the raw base below */ }
  return `${base}/embed/${id}?local=true`;
}

const snapshot = (video: VideoResult) => JSON.stringify(video);

export const videoHistory = (): VideoResult[] =>
  all<{ snapshot: string }>('SELECT snapshot FROM video_history WHERE user_id = ? ORDER BY at DESC LIMIT 60', currentUserId())
    .flatMap(r => { try { return [JSON.parse(r.snapshot) as VideoResult]; } catch { return []; } });

export function touchVideoHistory(video: VideoResult): void {
  const user = currentUserId();
  run(
    'INSERT INTO video_history (user_id, video_id, snapshot, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, video_id) DO UPDATE SET snapshot = excluded.snapshot, at = excluded.at',
    user, video.id, snapshot(video), new Date().toISOString()
  );
  run('DELETE FROM video_history WHERE user_id = ? AND video_id NOT IN (SELECT video_id FROM video_history WHERE user_id = ? ORDER BY at DESC LIMIT 60)', user, user);
}

export function clearVideoHistory(): void {
  run('DELETE FROM video_history WHERE user_id = ?', currentUserId());
}

export function removeFromVideoHistory(id: string): void {
  run('DELETE FROM video_history WHERE user_id = ? AND video_id = ?', currentUserId(), id);
}
