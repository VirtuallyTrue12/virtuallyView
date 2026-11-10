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
  /** The channel's picture, as an address on this server (see `imageProxyPath`). */
  channelThumb?: string;
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

interface RawThumb { url?: string; quality?: string; width?: number }
interface RawVideo {
  type?: string; videoId?: string; title?: string; author?: string; authorId?: string; lengthSeconds?: number; viewCount?: number; viewCountText?: string;
  published?: number | string; videoThumbnails?: RawThumb[]; description?: string; authorThumbnails?: RawThumb[];
}

/** "824M" / "1.2K" (what related videos carry instead of a number) as a number. */
export function parseCount(text: unknown): number {
  const m = /^([\d.,]+)\s*([KMB])?/i.exec(String(text ?? '').trim());
  if (!m) return 0;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K'] ?? 1)) : 0;
}

/** A channel picture or banner (on YouTube's image hosts) as a path on this server, which fetches it through the
 * instance's own /ggpht/ proxy: the browser never talks to Google, and this server only ever talks to the instance. */
export function imageProxyPath(url: string | undefined): string | undefined {
  const rest = /^(?:https?:)?\/\/yt3\.(?:ggpht|googleusercontent)\.com\/([\w\-=.,/]+)$/.exec(url ?? '')?.[1];
  return rest && !rest.includes('..') ? `/api/videos/image?p=${encodeURIComponent(`/ggpht/${rest}`)}` : undefined;
}

/** The upstream address for an image path given to `/api/videos/image`, or null for anything else. */
export function imageUpstream(p: string): string | null {
  const base = baseUrl();
  return base && /^\/ggpht\/[\w\-=.,/]+$/.test(p) && !p.includes('..') ? `${base}${p}` : null;
}

const pickThumb = (thumbs: RawThumb[] | undefined, width: number) =>
  [...(thumbs ?? [])].filter(t => t.url).sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find(t => (t.width ?? 0) >= width) ?? thumbs?.at(-1);

function toResult(raw: RawVideo): VideoResult | null {
  const id = clean(raw.videoId, 20);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const thumb = (raw.videoThumbnails ?? []).find(t => t.quality === 'medium') ?? raw.videoThumbnails?.[0];
  const when = typeof raw.published === 'number' ? new Date(raw.published * 1000) : raw.published ? new Date(raw.published) : null;
  const published = when && !Number.isNaN(when.getTime()) && when.getTime() > 0 ? when.toISOString() : undefined;
  const avatar = imageProxyPath(pickThumb(raw.authorThumbnails, 64)?.url);
  return {
    id, title: clean(raw.title, 200) || 'Untitled video', channel: clean(raw.author, 120),
    ...(clean(raw.authorId, 40) ? { channelId: clean(raw.authorId, 40) } : {}),
    durationSeconds: Number.isFinite(raw.lengthSeconds) ? Math.max(0, raw.lengthSeconds as number) : 0,
    views: Number.isFinite(raw.viewCount) ? Math.max(0, raw.viewCount as number) : parseCount(raw.viewCountText),
    ...(published ? { published } : {}),
    ...(thumb?.url ? { thumbnail: thumb.url } : {}),
    ...(raw.description ? { description: clean(raw.description, 2000) } : {}),
    ...(avatar ? { channelThumb: avatar } : {})
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
  const raw = await call<RawVideo>(`/api/v1/videos/${id}?fields=videoId,title,author,authorId,lengthSeconds,viewCount,published,videoThumbnails,description,authorThumbnails`);
  return toResult(raw);
}

const videosOf = (rows: unknown): VideoResult[] =>
  (Array.isArray(rows) ? rows as RawVideo[] : []).filter(r => !r.type || r.type === 'video' || r.type === 'shortVideo').map(toResult).filter((v): v is VideoResult => !!v);

/** What is trending (by country, two letters; the instance's default otherwise) and the instance's popular list. */
export async function trendingVideos(region?: string): Promise<VideoResult[]> {
  const r = /^[A-Z]{2}$/.test(region ?? '') ? `?region=${region}` : '';
  return videosOf(await call<unknown>(`/api/v1/trending${r}`)).slice(0, 40);
}
export async function popularVideos(): Promise<VideoResult[]> {
  return videosOf(await call<unknown>('/api/v1/popular')).slice(0, 40);
}

export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export interface ChannelResult {
  id: string; name: string; avatar?: string; banner?: string; subscribers: number; description?: string; videoCount?: number; verified?: boolean;
}
interface RawChannel {
  author?: string; authorId?: string; authorThumbnails?: RawThumb[]; authorBanners?: RawThumb[]; subCount?: number; description?: string;
  videoCount?: number; authorVerified?: boolean; latestVideos?: RawVideo[];
}
function toChannel(raw: RawChannel): ChannelResult | null {
  const id = clean(raw.authorId, 40);
  if (!CHANNEL_ID.test(id)) return null;
  const avatar = imageProxyPath(pickThumb(raw.authorThumbnails, 160)?.url);
  const banner = imageProxyPath(pickThumb(raw.authorBanners, 1280)?.url);
  return {
    id, name: clean(raw.author, 120) || 'Channel', subscribers: Number.isFinite(raw.subCount) ? Math.max(0, raw.subCount as number) : 0,
    ...(avatar ? { avatar } : {}), ...(banner ? { banner } : {}),
    ...(raw.description ? { description: clean(raw.description, 1000) } : {}),
    ...(Number.isFinite(raw.videoCount) ? { videoCount: raw.videoCount } : {}),
    ...(raw.authorVerified ? { verified: true } : {})
  };
}

export async function searchChannels(query: string): Promise<ChannelResult[]> {
  const q = clean(query, 100);
  if (!q) return [];
  const rows = await call<RawChannel[]>(`/api/v1/search?q=${encodeURIComponent(q)}&type=channel`);
  return (Array.isArray(rows) ? rows : []).map(toChannel).filter((c): c is ChannelResult => !!c).slice(0, 20);
}

export async function channelInfo(id: string): Promise<ChannelResult | null> {
  if (!CHANNEL_ID.test(id)) return null;
  return toChannel(await call<RawChannel>(`/api/v1/channels/${id}?fields=author,authorId,authorThumbnails,authorBanners,subCount,description,authorVerified`));
}

/** One page of a channel's uploads, newest first; `continuation` asks for the next page. */
export async function channelVideos(id: string, continuation?: string): Promise<{ videos: VideoResult[]; continuation?: string }> {
  if (!CHANNEL_ID.test(id)) return { videos: [] };
  const more = continuation && /^[\w%=-]{1,600}$/.test(continuation) ? `?continuation=${encodeURIComponent(continuation)}` : '';
  const page = await call<{ videos?: RawVideo[]; continuation?: string }>(`/api/v1/channels/${id}/videos${more}`);
  const next = clean(page.continuation, 600);
  return { videos: videosOf(page.videos), ...(next ? { continuation: next } : {}) };
}

// Each followed channel's newest uploads, kept a few minutes so opening Videos does not ask the instance every time.
const feedCache = new Map<string, { at: number; videos: VideoResult[] }>();
const FEED_TTL = 5 * 60 * 1000;
export const clearFeedCache = (): void => feedCache.clear();

/** Newest first across every channel, each video once. Pure, so it is tested without a network. */
export function mergeFeed(lists: VideoResult[][], limit = 60): VideoResult[] {
  const seen = new Set<string>();
  return lists.flat()
    .filter(v => (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
    .slice(0, limit);
}

/** The latest uploads of the given channels merged, newest first. A channel that fails is counted, not fatal. */
export async function subscriptionFeed(channelIds: string[]): Promise<{ videos: VideoResult[]; failed: number }> {
  const results = await Promise.allSettled(channelIds.map(async id => {
    const hit = feedCache.get(id);
    if (hit && Date.now() - hit.at < FEED_TTL) return hit.videos;
    const { videos } = await channelVideos(id);
    feedCache.set(id, { at: Date.now(), videos: videos.slice(0, 15) });
    return videos.slice(0, 15);
  }));
  return {
    videos: mergeFeed(results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))),
    failed: results.filter(r => r.status === 'rejected').length
  };
}

export interface Chapter { start: number; title: string }

/** Chapters written in a description the usual way ("0:00 Intro" lines, the first at 0:00). */
export function parseChapters(description: string | undefined): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of (description ?? '').split('\n')) {
    const m = /^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|]?\s*(.{1,120})$/.exec(line);
    if (!m) continue;
    const start = m[1]!.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
    if (chapters.length && start <= chapters.at(-1)!.start) continue;
    chapters.push({ start, title: m[2]!.trim() });
  }
  return chapters.length >= 2 && chapters[0]!.start === 0 ? chapters : [];
}

export interface VideoDetails extends VideoResult {
  publishedText?: string; likes: number; subscribersText?: string;
  captions: Array<{ label: string; code: string }>; chapters: Chapter[]; related: VideoResult[];
  /** The one file with sound and picture together (360p on most videos), for this app's own player. */
  hasStream: boolean;
}
interface RawDetails extends RawVideo {
  publishedText?: string; likeCount?: number; subCountText?: string;
  captions?: Array<{ label?: string; language_code?: string }>; recommendedVideos?: RawVideo[];
  formatStreams?: Array<{ itag?: string | number }>;
}

/** Everything the watch page shows: description, chapters, captions, related videos. */
export async function videoDetails(id: string): Promise<VideoDetails | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const raw = await call<RawDetails>(`/api/v1/videos/${id}`);
  const base = toResult({ ...raw, description: undefined });
  if (!base) return null;
  const description = clean(raw.description, 5000);
  return {
    ...base,
    ...(description ? { description } : {}),
    ...(raw.publishedText ? { publishedText: clean(raw.publishedText, 40) } : {}),
    likes: Number.isFinite(raw.likeCount) ? Math.max(0, raw.likeCount as number) : 0,
    ...(raw.subCountText ? { subscribersText: clean(raw.subCountText, 20) } : {}),
    captions: (raw.captions ?? []).map(c => ({ label: clean(c.label, 80), code: clean(c.language_code, 20) })).filter(c => c.label).slice(0, 40),
    chapters: parseChapters(raw.description),
    related: videosOf(raw.recommendedVideos).slice(0, 20),
    hasStream: (raw.formatStreams ?? []).some(f => String(f.itag) === '18')
  };
}

/** One caption track as WebVTT text (the instance converts it). */
export async function captionsVtt(id: string, label: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id) || !label || label.length > 80) return null;
  const base = baseUrl();
  if (!base) throw new NotConfigured();
  const res = await videoFetch(`${base}/api/v1/captions/${id}?label=${encodeURIComponent(label)}`);
  const text = res.ok ? await res.text() : '';
  return text.startsWith('WEBVTT') ? text.slice(0, 2_000_000) : null;
}

// Trailers, reviews and featurettes for a title, cached for hours: they rarely change.
const relatedCache = new Map<string, { at: number; videos: VideoResult[] }>();
const RELATED_TTL = 6 * 60 * 60 * 1000;

/** Videos about a film or show: its trailers first, then reviews and behind-the-scenes. */
export async function videosAboutTitle(title: string, year?: number, kind: 'movie' | 'series' = 'movie'): Promise<VideoResult[]> {
  const name = clean(title, 100);
  if (!name) return [];
  const when = year && year > 1880 && year < 2100 ? ` ${year}` : '';
  const key = `${kind}:${name.toLowerCase()}:${when}`;
  const hit = relatedCache.get(key);
  if (hit && Date.now() - hit.at < RELATED_TTL) return hit.videos;
  const what = kind === 'series' ? ' series' : '';
  const lists = await Promise.allSettled([`${name}${when}${what} trailer`, `${name}${when}${what} review`, `${name}${when} behind the scenes`].map(q => searchVideos(q)));
  const words = normalizeTitle(name);
  const seen = new Set<string>();
  // Only videos that name the title: a search for an obscure film otherwise fills up with unrelated ones.
  const videos = lists.flatMap(r => (r.status === 'fulfilled' ? r.value.slice(0, 8) : []))
    .filter(v => (seen.has(v.id) ? false : (seen.add(v.id), true)) && ` ${normalizeTitle(v.title)} `.includes(` ${words} `))
    .slice(0, 16);
  if (lists.some(r => r.status === 'fulfilled')) relatedCache.set(key, { at: Date.now(), videos });
  return videos;
}

const normalizeTitle = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/** The film or show in the library a video is about, judged by its title (and year, when the video names one). */
export function matchLibraryTitle<T extends { title: string; year?: number }>(videoTitle: string, items: T[]): T | null {
  const text = ` ${normalizeTitle(videoTitle)} `;
  const years = (videoTitle.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number);
  let best: T | null = null;
  for (const item of items) {
    const name = normalizeTitle(item.title);
    // Very short or one-word common titles ("Up", "It") would match half of YouTube.
    if (name.length < 4 || !text.includes(` ${name} `)) continue;
    if (years.length && item.year && !years.includes(item.year)) continue;
    if (!best || name.length > normalizeTitle(best.title).length) best = item;
  }
  return best;
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
  const base = browserBase(requestHost);
  return base && /^[A-Za-z0-9_-]{11}$/.test(id) ? `${base}/embed/${id}?local=true` : null;
}

/** The video itself (sound and picture in one 360p file), proxied by the instance, for this app's own player. */
export function streamUrl(id: string, requestHost?: string): string | null {
  const base = browserBase(requestHost);
  return base && /^[A-Za-z0-9_-]{11}$/.test(id) ? `${base}/latest_version?id=${id}&itag=18&local=true` : null;
}

function browserBase(requestHost?: string): string | null {
  const base = baseUrl();
  if (!base) return null;
  try {
    const parsed = new URL(base);
    if (parsed.hostname === 'invidious' && requestHost) {
      const host = requestHost.replace(/:\d+$/, '');
      const port = process.env.INVIDIOUS_EMBED_PORT ?? '3300';
      return `${parsed.protocol}//${host}:${port}`;
    }
  } catch { /* an unparsable INVIDIOUS_URL falls through to the raw base below */ }
  return base;
}

const snapshot = (video: VideoResult) => JSON.stringify(video);

export const videoHistory = (): Array<VideoResult & { position: number; duration: number }> =>
  all<{ snapshot: string; position: number; duration: number }>('SELECT snapshot, position, duration FROM video_history WHERE user_id = ? ORDER BY at DESC LIMIT 60', currentUserId())
    .flatMap(r => { try { return [{ ...JSON.parse(r.snapshot) as VideoResult, position: r.position, duration: r.duration }]; } catch { return []; } });

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
