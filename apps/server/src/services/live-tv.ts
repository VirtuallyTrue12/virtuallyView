import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { outboundFetch } from './outbound.js';

// Live TV from ordinary M3U playlists (the format IPTV lists, tuner boxes such
// as TVHeadend and free public lists all use). Nothing is bundled and no
// channel is added for you.

export interface Playlist { id: string; name: string; url: string; /** A program guide (XMLTV) address, when the playlist has none of its own. */ epgUrl?: string }
export interface Channel { id: string; name: string; logo?: string; group?: string; playlist: string; url: string; tvgId?: string }

const FILE = resolve(DATA_DIR, 'live-tv.json');
const MAX_CHANNELS = 8000;
const CACHE_MS = 30 * 60 * 1000;
const parsed = new Map<string, { at: number; channels: Channel[]; epg: string[] }>();
const known = new Map<string, Channel>();
/** Playlists are read again the next time they are needed. Channel ids already handed out stay valid. */
export const clearPlaylistCache = (): void => parsed.clear();

const shortId = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12);

export function listPlaylists(): Playlist[] {
  try { return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as { playlists?: Playlist[] }).playlists ?? [] : []; } catch { return []; }
}

function save(playlists: Playlist[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify({ playlists }), { encoding: 'utf8', mode: 0o600 });
}

export function addPlaylist(name: string, url: string, epgUrl = ''): { ok: true; playlist: Playlist } | { ok: false; message: string } {
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { return { ok: false, message: 'Enter a full address starting with http:// or https://.' }; }
  if (!/^https?:$/.test(parsedUrl.protocol)) return { ok: false, message: 'Only http and https addresses are supported.' };
  const list = listPlaylists();
  if (list.some(p => p.url === url)) return { ok: false, message: 'That playlist is already added.' };
  if (list.length >= 20) return { ok: false, message: 'Twenty playlists is the limit.' };
  let epg = '';
  if (epgUrl.trim()) {
    try { const e = new URL(epgUrl.trim()); if (!/^https?:$/.test(e.protocol)) throw new Error('scheme'); epg = e.toString(); } catch { return { ok: false, message: 'The program guide address must start with http:// or https://.' }; }
  }
  const playlist: Playlist = { id: shortId(url), name: name.trim().slice(0, 60) || parsedUrl.hostname, url, ...(epg ? { epgUrl: epg } : {}) };
  save([...list, playlist]);
  return { ok: true, playlist };
}

export function removePlaylist(id: string): boolean {
  const list = listPlaylists();
  if (!list.some(p => p.id === id)) return false;
  save(list.filter(p => p.id !== id));
  parsed.delete(id);
  return true;
}

/** #EXTINF lines followed by a stream address. */
/** Program guide addresses a playlist names in its first line (url-tvg="a.xml,b.xml"). */
export function epgUrlsOf(text: string): string[] {
  const head = text.slice(0, 2000).split(/\r?\n/).find(l => l.startsWith('#EXTM3U')) ?? '';
  const raw = /(?:url-tvg|x-tvg-url)="([^"]*)"/i.exec(head)?.[1] ?? '';
  return raw.split(',').map(u => u.trim()).filter(u => /^https?:\/\//i.test(u)).slice(0, 3);
}

export function parseM3u(text: string, playlist: string): Channel[] {
  const out: Channel[] = [];
  let pending: { name: string; logo?: string; group?: string } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const attr = (key: string) => new RegExp(`${key}="([^"]*)"`, 'i').exec(line)?.[1];
      const name = line.slice(line.lastIndexOf(',') + 1).trim() || attr('tvg-name') || 'Channel';
      const logo = attr('tvg-logo');
      const group = attr('group-title');
      const tvgId = attr('tvg-id');
      pending = { name, ...(logo ? { logo } : {}), ...(group ? { group } : {}), ...(tvgId ? { tvgId } : {}) };
    } else if (line && !line.startsWith('#') && pending && /^https?:\/\//i.test(line)) {
      out.push({ id: shortId(`${playlist}|${line}`), playlist, url: line, ...pending });
      pending = null;
      if (out.length >= MAX_CHANNELS) break;
    }
  }
  return out;
}

export async function channelsFor(playlist: Playlist): Promise<Channel[]> {
  const hit = parsed.get(playlist.id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.channels;
  const res = await outboundFetch(playlist.url, { timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`The playlist answered ${res.status}.`);
  const text = await res.text();
  const channels = parseM3u(text, playlist.id);
  parsed.set(playlist.id, { at: Date.now(), channels, epg: playlist.epgUrl ? [playlist.epgUrl] : epgUrlsOf(text) });
  for (const channel of channels) known.set(channel.id, channel);
  return channels;
}

/**
 * The channel behind an id. Addresses live in memory, so after a restart (an
 * update, a backup restore) the page may still show channels the server has
 * not loaded yet: read the playlists again before giving up.
 */
export async function channelById(id: string): Promise<Channel | undefined> {
  const hit = known.get(id);
  if (hit) return hit;
  for (const playlist of listPlaylists()) {
    try {
      const found = (await channelsFor(playlist)).find(channel => channel.id === id);
      if (found) return found;
    } catch { /* that playlist is unreachable: try the next */ }
  }
  return undefined;
}

// Playlist rewriting: every address inside a stream playlist goes back through
// this server, signed, so the browser needs no CORS and the relay only ever
// fetches addresses the playlist itself named.
let relayKey: Buffer | null = null;
function key(): Buffer {
  if (relayKey) return relayKey;
  const file = resolve(DATA_DIR, 'relay.key');
  if (existsSync(file)) relayKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  else { relayKey = randomBytes(32); mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(file, relayKey.toString('hex'), { encoding: 'utf8', mode: 0o600 }); }
  return relayKey;
}
// A relay link works for the address it names, for a limited time, and nowhere else.
const RELAY_LIFETIME_MS = 12 * 3_600_000;
const sign = (url: string, expires: number) => createHmac('sha256', key()).update(`relay|${expires}|${url}`).digest('hex').slice(0, 32);
export function verifyRelay(url: string, sig: string, expires: string | number | undefined): boolean {
  const at = Number(expires);
  if (!/^https?:\/\//i.test(url) || !Number.isFinite(at) || at < Date.now()) return false;
  const expected = Buffer.from(sign(url, at));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
const relayLink = (url: string) => {
  const expires = Date.now() + RELAY_LIFETIME_MS;
  return `/api/live/relay?u=${encodeURIComponent(url)}&e=${expires}&s=${sign(url, expires)}`;
};

export function rewriteHls(body: string, base: string): string {
  const abs = (ref: string) => relayLink(new URL(ref, base).toString());
  return body.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${abs(uri)}"`);
    return abs(trimmed);
  }).join('\n');
}

/** Where a playlist's program guide comes from, once the playlist has been read. */
export const guideSources = (playlistId: string): string[] => parsed.get(playlistId)?.epg ?? [];
export const knownChannel = (id: string): Channel | undefined => known.get(id);
