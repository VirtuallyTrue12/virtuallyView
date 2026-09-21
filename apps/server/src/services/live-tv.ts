import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { outboundFetch } from './outbound.js';

// Live TV from ordinary M3U playlists (the format IPTV lists, tuner boxes such
// as TVHeadend and free public lists all use). Nothing is bundled and no
// channel is added for you.

export interface Playlist { id: string; name: string; url: string }
export interface Channel { id: string; name: string; logo?: string; group?: string; playlist: string; url: string }

const FILE = resolve(DATA_DIR, 'live-tv.json');
const MAX_CHANNELS = 8000;
const CACHE_MS = 30 * 60 * 1000;
const parsed = new Map<string, { at: number; channels: Channel[] }>();
const known = new Map<string, Channel>();

const shortId = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12);

export function listPlaylists(): Playlist[] {
  try { return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as { playlists?: Playlist[] }).playlists ?? [] : []; } catch { return []; }
}

function save(playlists: Playlist[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify({ playlists }), { encoding: 'utf8', mode: 0o600 });
}

export function addPlaylist(name: string, url: string): { ok: true; playlist: Playlist } | { ok: false; message: string } {
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { return { ok: false, message: 'Enter a full address starting with http:// or https://.' }; }
  if (!/^https?:$/.test(parsedUrl.protocol)) return { ok: false, message: 'Only http and https addresses are supported.' };
  const list = listPlaylists();
  if (list.some(p => p.url === url)) return { ok: false, message: 'That playlist is already added.' };
  if (list.length >= 20) return { ok: false, message: 'Twenty playlists is the limit.' };
  const playlist = { id: shortId(url), name: name.trim().slice(0, 60) || parsedUrl.hostname, url };
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
      pending = { name, ...(logo ? { logo } : {}), ...(group ? { group } : {}) };
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
  const channels = parseM3u(await res.text(), playlist.id);
  parsed.set(playlist.id, { at: Date.now(), channels });
  for (const channel of channels) known.set(channel.id, channel);
  return channels;
}

export const channelById = (id: string): Channel | undefined => known.get(id);

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
const sign = (url: string) => createHmac('sha256', key()).update(url).digest('hex').slice(0, 32);
export const verifyRelay = (url: string, sig: string) => /^https?:\/\//i.test(url) && sign(url) === sig;
const relayLink = (url: string) => `/api/live/relay?u=${encodeURIComponent(url)}&s=${sign(url)}`;

export function rewriteHls(body: string, base: string): string {
  const abs = (ref: string) => relayLink(new URL(ref, base).toString());
  return body.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${abs(uri)}"`);
    return abs(trimmed);
  }).join('\n');
}
