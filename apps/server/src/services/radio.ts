import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { all, run } from '../db/app-db.js';
import { outboundFetch } from './outbound.js';
import { currentUserId } from './user-context.js';

/**
 * Internet radio by region, from the Radio Browser directory (radio-browser.info): an open, community-run list of
 * about forty thousand stations with no account or key. The page only ever sees station ids; the stream address
 * stays here and the audio is relayed by this server, so an http:// station still plays on an https:// page and
 * the station never learns the viewer's address.
 */

export interface Station {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  state?: string;
  language?: string;
  tags: string[];
  codec?: string;
  bitrate?: number;
  homepage?: string;
  votes: number;
  /** True when the station has its own picture (served by /api/radio/logo/:id). */
  logo: boolean;
  /** Streams as HLS (segments), which the page plays with hls.js. */
  hls?: boolean;
}
export interface RadioCountry { name: string; code: string; stations: number }
export interface RadioTag { name: string; stations: number }

interface RawStation {
  stationuuid: string; name: string; url: string; url_resolved?: string; homepage?: string; favicon?: string; tags?: string; country?: string;
  countrycode?: string; state?: string; language?: string; codec?: string; bitrate?: number; votes?: number; lastcheckok?: number; hls?: number;
}

const FALLBACK_HOSTS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'nl1.api.radio-browser.info', 'at1.api.radio-browser.info'];
const cache = new Map<string, { at: number; value: unknown }>();
const streams = new Map<string, { url: string; favicon?: string; name: string; hls: boolean }>();
let hosts: { at: number; list: string[] } | undefined;

async function apiHosts(): Promise<string[]> {
  if (hosts && Date.now() - hosts.at < 6 * 3_600_000) return hosts.list;
  let list = FALLBACK_HOSTS;
  try {
    const res = await outboundFetch('https://all.api.radio-browser.info/json/servers', { timeoutMs: 5000, headers: { 'User-Agent': 'virtuallyView' } });
    if (res.ok) {
      const found = ((await res.json()) as Array<{ name?: string }>).map(s => s.name).filter((n): n is string => !!n && /^[a-z0-9.-]+\.radio-browser\.info$/.test(n));
      if (found.length) list = found.sort(() => Math.random() - 0.5);
    }
  } catch { /* the built-in list is fine */ }
  hosts = { at: Date.now(), list };
  return list;
}

/** Read from the directory, trying each mirror; answers are kept for a while so browsing stays fast. */
async function directory<T>(path: string, ttlMs = 10 * 60_000): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  let last: unknown;
  for (const host of (await apiHosts()).slice(0, 4)) {
    try {
      const res = await outboundFetch(`https://${host}${path}`, { timeoutMs: 9000, headers: { 'User-Agent': 'virtuallyView' } });
      if (!res.ok) { last = new Error(`the directory answered ${res.status}`); continue; }
      const value = await res.json() as T;
      cache.set(path, { at: Date.now(), value });
      if (cache.size > 300) cache.delete(cache.keys().next().value as string);
      return value;
    } catch (error) { last = error; }
  }
  if (hit) return hit.value as T; // stale is better than nothing
  throw new Error(`The radio directory could not be reached${last instanceof Error ? ` (${last.message})` : ''}. Try again in a moment.`);
}

const clean = (value: string | undefined, max = 120) => (value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

function toStation(raw: RawStation): Station | null {
  const id = raw.stationuuid;
  const url = raw.url_resolved || raw.url;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !/^https?:\/\//i.test(url ?? '')) return null;
  streams.set(id, { url, favicon: /^https?:\/\//i.test(raw.favicon ?? '') ? raw.favicon : undefined, name: clean(raw.name), hls: raw.hls === 1 });
  if (streams.size > 5000) streams.delete(streams.keys().next().value as string);
  const homepage = /^https?:\/\//i.test(raw.homepage ?? '') ? clean(raw.homepage, 200) : undefined;
  return {
    id, name: clean(raw.name) || 'Unnamed station', country: clean(raw.country, 60), countryCode: clean(raw.countrycode, 2).toUpperCase(),
    ...(clean(raw.state, 60) ? { state: clean(raw.state, 60) } : {}), ...(clean(raw.language, 60) ? { language: clean(raw.language, 60) } : {}),
    tags: clean(raw.tags, 200).split(',').map(t => t.trim()).filter(Boolean).slice(0, 4),
    ...(raw.codec ? { codec: clean(raw.codec, 12) } : {}), ...(raw.bitrate ? { bitrate: raw.bitrate } : {}), ...(homepage ? { homepage } : {}),
    votes: raw.votes ?? 0, logo: !!streams.get(id)?.favicon, ...(raw.hls === 1 ? { hls: true } : {})
  };
}

export async function radioCountries(): Promise<RadioCountry[]> {
  const rows = await directory<Array<{ name: string; iso_3166_1: string; stationcount: number }>>('/json/countries?hidebroken=true', 6 * 3_600_000);
  return rows.filter(r => /^[A-Za-z]{2}$/.test(r.iso_3166_1 ?? '') && r.name?.trim() && r.iso_3166_1 !== 'XX' && r.stationcount > 0).map(r => ({ name: clean(r.name, 60), code: r.iso_3166_1.toUpperCase(), stations: r.stationcount })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Regions of a country (states, provinces) that have stations. */
export async function radioRegions(code: string): Promise<RadioCountry[]> {
  if (!/^[A-Za-z]{2}$/.test(code)) return [];
  const rows = await directory<Array<{ name: string; country: string; stationcount: number }>>(`/json/states?hidebroken=true`, 6 * 3_600_000);
  const countries = await radioCountries();
  const country = countries.find(c => c.code === code.toUpperCase());
  if (!country) return [];
  return Array.from(rows.filter(r => r.name && r.stationcount > 0 && r.country?.toLowerCase() === country.name.toLowerCase())
    
    .reduce<Map<string, RadioCountry>>((acc, r) => {
      const key = clean(r.name, 60).toLowerCase();
      const label = key.replace(/(^|[\s-])(\p{L})/gu, (_m, gap: string, ch: string) => gap + ch.toUpperCase());
      const prior = acc.get(key);
      acc.set(key, { name: label, code: label, stations: (prior?.stations ?? 0) + r.stationcount });
      return acc;
    }, new Map()).values()).sort((a, b) => b.stations - a.stations).slice(0, 120);
}

export async function radioTags(code?: string): Promise<RadioTag[]> {
  const path = `/json/tags?order=stationcount&reverse=true&limit=70&hidebroken=true`;
  void code;
  const rows = await directory<Array<{ name: string; stationcount: number }>>(path, 6 * 3_600_000);
  return rows.filter(r => r.name && /^[\p{L}\p{N} &'+-]{2,30}$/u.test(r.name)).map(r => ({ name: r.name, stations: r.stationcount }));
}

export interface StationQuery { country?: string; region?: string; tag?: string; q?: string; language?: string; limit?: number; offset?: number }

export async function searchStations(query: StationQuery): Promise<{ stations: Station[]; more: boolean }> {
  const limit = Math.min(Math.max(query.limit ?? 40, 1), 100);
  const params = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(limit + 1), offset: String(Math.max(query.offset ?? 0, 0)) });
  if (query.country && /^[A-Za-z]{2}$/.test(query.country)) params.set('countrycode', query.country.toUpperCase());
  if (query.region) params.set('state', clean(query.region, 60));
  if (query.tag) { params.set('tag', clean(query.tag, 40)); params.set('tagExact', 'true'); }
  if (query.q) params.set('name', clean(query.q, 60));
  if (query.language) params.set('language', clean(query.language, 40));
  const rows = await directory<RawStation[]>(`/json/stations/search?${params}`, 5 * 60_000);
  const stations = rows.map(toStation).filter((s): s is Station => !!s);
  return { stations: stations.slice(0, limit), more: rows.length > limit };
}

export async function stationById(id: string): Promise<{ url: string; favicon?: string; name: string; hls: boolean } | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const known = streams.get(id);
  if (known) return known;
  try {
    const rows = await directory<RawStation[]>(`/json/stations/byuuid/${id}`, 60 * 60_000);
    if (rows[0]) toStation(rows[0]);
  } catch { /* unknown */ }
  return streams.get(id);
}

/** A courtesy the directory asks for: count a listen, so popular stations rank higher. */
export function countListen(id: string): void {
  void directory(`/json/url/${id}`, 30_000).catch(() => undefined);
}

/** Streams come from a public list: never let one point this server at something inside the private network. */
export async function isPublicUrl(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const addresses = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => {
      const a = address.toLowerCase();
      if (a.includes(':')) return !(a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80') || a.startsWith('::ffff:127.') || a.startsWith('::ffff:10.') || a.startsWith('::ffff:192.168.'));
      const [p, q] = a.split('.').map(Number) as [number, number];
      return !(p === 10 || p === 127 || p === 0 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254) || (p === 100 && q >= 64 && q <= 127) || p >= 224);
    });
  } catch { return false; }
}

/** What the station says is playing right now (its ICY title), read from a short second connection. */
export async function nowPlaying(url: string): Promise<string | null> {
  if (!(await isPublicUrl(url))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'virtuallyView' }, signal: controller.signal, redirect: 'follow' });
    const every = Number(res.headers.get('icy-metaint'));
    if (!res.ok || !res.body || !Number.isInteger(every) || every <= 0 || every > 65536) return null;
    const reader = res.body.getReader();
    let buffer = Buffer.alloc(0);
    const need = async (n: number) => { while (buffer.length < n) { const { done, value } = await reader.read(); if (done) throw new Error('ended'); buffer = Buffer.concat([buffer, Buffer.from(value)]); } };
    await need(every + 1);
    const length = buffer[every]! * 16;
    let title: string | null = null;
    if (length > 0) { await need(every + 1 + length); title = /StreamTitle='([^']*)'/.exec(buffer.subarray(every + 1, every + 1 + length).toString('utf8'))?.[1]?.trim() || null; }
    void reader.cancel();
    return title ? clean(title, 140) : null;
  } catch { return null; } finally { clearTimeout(timer); controller.abort(); }
}

// ---- Each person's favorites and recent stations (a snapshot is kept so a favorite still shows when the directory is slow).

const snapshot = (s: Station) => JSON.stringify(s);
const readRows = (kind: 'favorite' | 'recent', limit: number): Station[] =>
  all<{ snapshot: string }>('SELECT snapshot FROM radio_stations WHERE user_id = ? AND kind = ? ORDER BY at DESC LIMIT ?', currentUserId(), kind, limit)
    .flatMap(r => { try { return [JSON.parse(r.snapshot) as Station]; } catch { return []; } });

export const favoriteStations = (): Station[] => readRows('favorite', 200);
export const recentStations = (): Station[] => readRows('recent', 20);

export function setStationFavorite(station: Station, favorite: boolean): void {
  const user = currentUserId();
  if (!favorite) { run('DELETE FROM radio_stations WHERE user_id = ? AND station_id = ? AND kind = ?', user, station.id, 'favorite'); return; }
  run('INSERT INTO radio_stations (user_id, station_id, kind, snapshot, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, station_id, kind) DO UPDATE SET snapshot = excluded.snapshot, at = excluded.at', user, station.id, 'favorite', snapshot(station), new Date().toISOString());
}

export function touchStation(station: Station): void {
  const user = currentUserId();
  run('INSERT INTO radio_stations (user_id, station_id, kind, snapshot, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, station_id, kind) DO UPDATE SET snapshot = excluded.snapshot, at = excluded.at', user, station.id, 'recent', snapshot(station), new Date().toISOString());
  run('DELETE FROM radio_stations WHERE user_id = ? AND kind = ? AND station_id NOT IN (SELECT station_id FROM radio_stations WHERE user_id = ? AND kind = ? ORDER BY at DESC LIMIT 20)', user, 'recent', user, 'recent');
}

/** A station as the directory describes it, for saving a favorite: the client sends only an id. */
export async function stationInfo(id: string): Promise<Station | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  try {
    const rows = await directory<RawStation[]>(`/json/stations/byuuid/${id}`, 60 * 60_000);
    return rows[0] ? toStation(rows[0]) ?? undefined : undefined;
  } catch { return undefined; }
}
