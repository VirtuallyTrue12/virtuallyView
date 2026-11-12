import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { artProxyUrl } from '@virtuallyview/integrations';
import { all, run } from '../db/app-db.js';
import { healthStore, isDead, probeStream } from './live-probe.js';
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
  /** "live": a real broadcaster's on-air stream. "playlist": a fan-made automatic playlist (no live show). */
  kind?: 'live' | 'playlist';
  /** What it mostly airs, from its tags and name (see stationTopics). */
  topics?: Topic[];
  /** The background check's answer: "dead" failed twice in a row and is hidden unless all=1. */
  health?: 'ok' | 'dead' | 'unknown';
}
export interface RadioCountry { name: string; code: string; stations: number }
export interface RadioTag { name: string; stations: number }

interface RawStation {
  stationuuid: string; name: string; url: string; url_resolved?: string; homepage?: string; favicon?: string; tags?: string; country?: string;
  countrycode?: string; state?: string; language?: string; codec?: string; bitrate?: number; votes?: number; lastcheckok?: number; hls?: number;
}

// RADIO_BROWSER_URL: another directory with the same API (a mirror, or the fake one the tests run).
const OWN_DIRECTORY = process.env.RADIO_BROWSER_URL?.replace(/\/$/, '');
const FALLBACK_HOSTS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'nl1.api.radio-browser.info', 'at1.api.radio-browser.info'];
const cache = new Map<string, { at: number; value: unknown }>();
const streams = new Map<string, { url: string; favicon?: string; name: string; hls: boolean }>();
let hosts: { at: number; list: string[] } | undefined;

async function apiHosts(): Promise<string[]> {
  if (OWN_DIRECTORY) return [OWN_DIRECTORY];
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
      const res = await outboundFetch(`${host.includes('://') ? host : `https://${host}`}${path}`, { timeoutMs: 9000, headers: { 'User-Agent': 'virtuallyView' } });
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

// Free hosting for do-it-yourself stations: almost always someone's automatic playlist, often named after a real
// FM station it is not ("BIG 92.7 FM" on zeno.fm is a fan upload).
const PLAYLIST_HOSTS = /(^|\.)(zeno\.fm|fastcast4u\.com|rcast\.net|caster\.fm|radiojar\.com|myradiostream\.com|listen2myradio\.com|radionomy\.com|live365\.com|radioca\.st|epichosts\.co\.uk|streamakaci\.com|onlineradiobox\.com|shoutcast\.com|radio12345\.com|streeemer\.com|mixlr\.com|radioking\.com|uber\.radio)$|azuracast|autodj/i;
// Content delivery used by broadcasters themselves for their on-air signal.
const BROADCASTER_HOSTS = /(^|\.)(bitgravity\.com|akamaized\.net|akamaihd\.net|streamtheworld\.com|musicradio\.com|ihrhls\.com|radiofrance\.fr|rtl\.fr|sharp-stream\.com|streamguys1\.com|dradio\.de|deutschlandradio\.de|swr\.de|wdr\.de|ndr\.de|br\.de|mdr\.de|hr\.de|rbb-online\.de|orf\.at|srf\.ch|rai\.it|rtve\.es|abc\.net\.au|cbc\.ca|radio-canada\.ca|npr\.org|rte\.ie|yle\.fi|nrk\.no|sr\.se|dr\.dk|vrt\.be|rtbf\.be|nporadio\.nl|nhk\.or\.jp|kbs\.co\.kr|bbc\.co\.uk|bbci\.co\.uk|infomaniak\.ch|lagardere\.cloud|europe1\.fr|ice\.radio|tdf-cdn\.com|newsonair\.gov\.in|prasarbharati\.gov\.in)$/i;
const LIVE_TAGS = /^(news|talk|public radio|sport|sports|news talk|talk radio|political talk|current affairs|business news|information)$/i;
const PLAYLIST_NAMES = /non-?stop|24\s*[/x*]\s*7|\bhits of\b|\bsongs\b|\bauto ?dj\b/i;
// More delivery networks that only real broadcasters (public and big commercial) use.
const BROADCASTER_MORE_HOSTS = /(^|\.)(revma\.com|amperwave\.net|hellorayo\.co\.uk|planetradio\.co\.uk|bbcmedia\.co\.uk|publicradio\.org|wnyc\.org|talksport\.com|kcrw\.com|kexp\.org|gbnews\.com|intoday\.in|radiocity\.in|radiomirchi\.com|redfmindia\.in|bigfmindia\.com|zdf\.de|ard\.de|rnz\.co\.nz|rts\.ch|rsi\.ch|rtl\.de|rmf\.fm|polskieradio\.pl|ert\.gr)$/i;
const BROADCASTER_HOMEPAGES = /(^|\.)(allindiaradio\.gov\.in|newsonair\.gov\.in|prasarbharati\.gov\.in|bbc\.co\.uk|bbc\.com|iheart\.com|globalplayer\.com|hellorayo\.co\.uk|radiocity\.in|radiomirchi\.com|redfmindia\.in|bigfmindia\.com|npr\.org|wnyc\.org|abc\.net\.au|cbc\.ca|radio-canada\.ca|radiofrance\.fr|rnz\.co\.nz|ndr\.de|wdr\.de|br\.de|swr\.de|hr\.de|mdr\.de|srf\.ch|rai\.it|rte\.ie|nrk\.no|sverigesradio\.se|dr\.dk|vrt\.be)$|\.gov(\.[a-z]{2})?$/i;
// "98.3 FM", "FM 93.5", "AM 1010": a real over-the-air frequency in the name.
const FREQUENCY = /\b\d{2,3}(\.\d{1,2})?\s*(fm|mhz)\b|\b(fm|am)\s*\d{2,4}(\.\d)?\b|\b\d{3,4}\s*am\b/i;

// Big Indian FM brands and AIR: real broadcasters, but only trusted off a bare IP address (fan relays use those).
const BRAND_NAMES = /\b(radio mirchi|radio city|red fm|big fm|all india radio|akashvani|vividh bharati|air fm)\b|^air\b/i;

const hostOf = (value?: string) => { try { return new URL(value ?? '').hostname; } catch { return ''; } };

/**
 * "live" only with positive evidence of a real broadcaster: its delivery network or homepage, a news/talk/sport tag,
 * or an over-the-air frequency in the name. Everything else is "playlist" when it looks automatic, or unlabelled.
 */
export function stationKind(raw: { url?: string; url_resolved?: string; name?: string; tags?: string; homepage?: string }): 'live' | 'playlist' | undefined {
  const host = hostOf(raw.url_resolved || raw.url);
  if (!host) return undefined;
  if (PLAYLIST_HOSTS.test(host)) return 'playlist';
  // A broadcaster's own delivery network wins over the name: "Raagam AIR 24*7" is All India Radio itself.
  if (BROADCASTER_HOSTS.test(host) || BROADCASTER_MORE_HOSTS.test(host) || BROADCASTER_HOMEPAGES.test(hostOf(raw.homepage))) return 'live';
  if (PLAYLIST_NAMES.test(raw.name ?? '')) return 'playlist';
  if (BRAND_NAMES.test(raw.name ?? '') && !/^[\d.]+$/.test(host)) return 'live';
  if ((raw.tags ?? '').split(',').some(t => LIVE_TAGS.test(t.trim())) || FREQUENCY.test(raw.name ?? '')) return 'live';
  return undefined;
}

export type Topic = 'news' | 'talk' | 'sports' | 'devotional' | 'music';
const TOPIC_TAGS: Array<[Topic, RegExp]> = [
  ['news', /\bnews|current affairs|information|public radio|samachar|khabar/i],
  ['talk', /\btalk|spoken|comedy|culture|education|discussion|interview|podcast|drama|story|storytelling/i],
  ['sports', /sport|cricket|football|soccer|\bespn\b|baseball|basketball|hockey|racing/i],
  ['devotional', /devotion|religio|christian|gospel|catholic|church|worship|praise|bible|islam|quran|muslim|hindu|bhakti|bhajan|kirtan|gurbani|sikh|spiritual|sufi|buddh|jewish|mantra|aarti|temple/i],
  ['music', /music|\bpop\b|rock|hits|jazz|classical|bollywood|filmi|dance|country|hip.?hop|r&b|rnb|oldies|retro|\b[5-9]0s\b|\b00s\b|top ?40|indie|electronic|edm|house|techno|lounge|chill|soul|funk|blues|reggae|latin|metal|punk|folk|carnatic|hindustani|ghazal|melod|songs|adult contemporary|\bac\b|\bchr\b|easy listening|instrumental/i]
];

/**
 * What a station mostly airs, from the directory's tags (and its name, which often says "News" or "Sports").
 * A station with no topic at all is counted as music: that is what almost every untagged FM station plays.
 */
export function stationTopics(raw: { name?: string; tags?: string }): Topic[] {
  const tags = (raw.tags ?? '').split(',').map(t => t.trim()).filter(Boolean);
  const name = raw.name ?? '';
  const found = TOPIC_TAGS.filter(([topic, re]) => tags.some(t => re.test(t)) || (topic !== 'music' && topic !== 'talk' && re.test(name))).map(([topic]) => topic);
  return found.length ? found : ['music'];
}

function toStation(raw: RawStation): Station | null {
  const id = raw.stationuuid;
  const url = raw.url_resolved || raw.url;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !/^https?:\/\//i.test(url ?? '')) return null;
  streams.set(id, { url, favicon: /^https?:\/\//i.test(raw.favicon ?? '') ? raw.favicon : undefined, name: clean(raw.name), hls: raw.hls === 1 });
  if (streams.size > 5000) streams.delete(streams.keys().next().value as string);
  const kind = stationKind(raw);
  const homepage = /^https?:\/\//i.test(raw.homepage ?? '') ? clean(raw.homepage, 200) : undefined;
  return {
    id, name: clean(raw.name) || 'Unnamed station', country: clean(raw.country, 60), countryCode: clean(raw.countrycode, 2).toUpperCase(),
    ...(clean(raw.state, 60) ? { state: clean(raw.state, 60) } : {}), ...(clean(raw.language, 60) ? { language: clean(raw.language, 60) } : {}),
    tags: clean(raw.tags, 200).split(',').map(t => t.trim()).filter(Boolean).slice(0, 4),
    ...(raw.codec ? { codec: clean(raw.codec, 12) } : {}), ...(raw.bitrate ? { bitrate: raw.bitrate } : {}), ...(homepage ? { homepage } : {}),
    votes: raw.votes ?? 0, logo: !!streams.get(id)?.favicon, ...(raw.hls === 1 ? { hls: true } : {}),
    ...(kind ? { kind } : {}), topics: stationTopics(raw)
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

// ---- Which stations really play: a slow background check (three at a time) plays a little of each listed station,
// a real segment for HLS or the first few KB of audio otherwise. Two failures in a row hide it for a day.

const radioFetcher = (url: string, init: { headers?: Record<string, string>; timeoutMs?: number } = {}) =>
  safeFetch(url, { headers: { 'User-Agent': 'virtuallyView', ...init.headers }, signal: AbortSignal.timeout(init.timeoutMs ?? 8000) });
export const radioHealth = healthStore<{ id: string; url: string }>('radio-health.json', { concurrency: 3, probe: url => probeStream(url, radioFetcher) });

export function healthWord(id: string): NonNullable<Station['health']> {
  const h = radioHealth.healthOf(id);
  return !h ? 'unknown' : isDead(h) ? 'dead' : h.ok ? 'ok' : 'unknown';
}

/** Marks each station's health and queues the unchecked ones; dead ones are dropped unless `all`. */
export function checked(stations: Station[], all = false): Station[] {
  radioHealth.scheduleProbes(stations.flatMap(s => { const url = streams.get(s.id)?.url; return url ? [{ id: s.id, url }] : []; }));
  return stations.map(s => ({ ...s, health: healthWord(s.id) })).filter(s => all || s.health !== 'dead');
}

/** A country's (or one of its regions') most played stations, for the home rows. */
export async function countryStations(code: string, region?: string): Promise<Station[]> {
  if (!/^[A-Za-z]{2}$/.test(code)) return [];
  const params = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: region ? '300' : '1000', countrycode: code.toUpperCase() });
  if (region) params.set('state', clean(region, 60));
  const rows = await directory<RawStation[]>(`/json/stations/search?${params}`, 10 * 60_000);
  return rows.map(toStation).filter((s): s is Station => !!s);
}

export interface StationQuery { country?: string; region?: string; tag?: string; q?: string; language?: string; limit?: number; offset?: number; liveOnly?: boolean; all?: boolean }

export async function searchStations(query: StationQuery): Promise<{ stations: Station[]; more: boolean }> {
  const limit = Math.min(Math.max(query.limit ?? 40, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  // Live only: most of the popular list is automatic playlists, so read a deep slice of it (by clicks) and page
  // through just the real broadcasts, in the same popularity order.
  const deep = !!query.liveOnly;
  const params = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(deep ? 500 : limit + 1), offset: String(deep ? 0 : offset) });
  if (query.country && /^[A-Za-z]{2}$/.test(query.country)) params.set('countrycode', query.country.toUpperCase());
  if (query.region) params.set('state', clean(query.region, 60));
  if (query.tag) { params.set('tag', clean(query.tag, 40)); params.set('tagExact', 'true'); }
  if (query.q) params.set('name', clean(query.q, 60));
  if (query.language) params.set('language', clean(query.language, 40));
  const rows = await directory<RawStation[]>(`/json/stations/search?${params}`, 5 * 60_000);
  const stations = rows.map(toStation).filter((s): s is Station => !!s);
  if (deep) {
    const live = checked(stations.filter(s => s.kind === 'live'), query.all);
    return { stations: live.slice(offset, offset + limit), more: live.length > offset + limit };
  }
  // Real broadcasts first, fan playlists last, otherwise in order of popularity.
  const rank = (s: Station) => (s.kind === 'live' ? 0 : s.kind === 'playlist' ? 2 : 1);
  const page = checked(stations.slice(0, limit), query.all).map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map(x => x.s);
  return { stations: page, more: rows.length > limit };
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

/** True for a real, routable public IPv4 address: never loopback, a private range, link-local (also where
 * cloud metadata endpoints live, e.g. 169.254.169.254), CGNAT, or reserved/multicast. */
function isPublicIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [p, q] = parts as [number, number];
  return !(p === 10 || p === 127 || p === 0 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254) || (p === 100 && q >= 64 && q <= 127) || p >= 224);
}

/** Same check for one resolved address, IPv4 or IPv6 — including an IPv4-mapped IPv6 address
 * (`::ffff:a.b.c.d`), which is a real, connectable route to that IPv4 address and not a distinct case:
 * checking only the bare private/link-local IPv6 ranges and missing this form entirely (as an earlier
 * version of this check did, letting `::ffff:169.254.169.254` straight through) is a real SSRF hole, not
 * a theoretical one, since a DNS response fully controls which form an attacker-chosen address arrives in. */
function isPublicAddress(rawAddress: string): boolean {
  const a = rawAddress.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return isPublicIPv4(mapped[1]!);
  if (a.includes(':')) return !(a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80'));
  return isPublicIPv4(a);
}

/** Streams come from a public list: never let one point this server at something inside the private network. */
export async function isPublicUrl(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    // Test-only: the end-to-end tests play fake stations on 127.0.0.1. Never set this on a real server.
    if (process.env.VV_RADIO_ALLOW_LOCAL === '1') return true;
    // A literal IPv6 URL keeps its brackets in .hostname ("[::1]"); isIP and dns.lookup both need them gone.
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address));
  } catch { return false; }
}

/**
 * A public-only fetch that re-checks the address on every redirect hop, not only the first: `redirect:
 * 'follow'` trusts that the one check done for the original URL still holds after a 3xx points somewhere
 * else, which a compromised directory entry, or a DNS answer that changes between the check and the
 * connection, can defeat (classic SSRF-via-redirect). Each hop is validated before it is ever requested.
 */
export async function safeFetch(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}, redirectsLeft = 5): Promise<Response> {
  if (!(await isPublicUrl(url))) throw new Error('That address is not allowed.');
  const res = await fetch(url, { ...init, redirect: 'manual' });
  const location = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && location && redirectsLeft > 0) {
    const next = new URL(location, url).toString();
    void res.body?.cancel();
    return safeFetch(next, init, redirectsLeft - 1);
  }
  return res;
}

export interface NowPlaying { title: string | null; artist?: string; song?: string; /** Cover art, served through /api/art. */ art?: string }

const JUNK_TITLE = /^(advert\w*|commercials?|ad ?break|unknown|untitled|n\/a|[-.\s]*|live|on ?air|stream|radio|null|undefined)$/i;
/** An ICY title split into artist and song ("Artist - Song"); station names, ads and blanks are no title. */
export function splitTitle(raw: string | null, station = ''): Omit<NowPlaying, 'art'> {
  let title = (raw ?? '').replace(/\s+/g, ' ').trim();
  // iHeart style: Artist - text="Song" song_spot="M" ...
  const tagged = /^(.*?)\s*-\s*text="([^"]*)"/.exec(title);
  if (tagged) title = tagged[1] && tagged[2] ? `${tagged[1].trim()} - ${tagged[2].trim()}` : (tagged[2] || tagged[1] || '').trim();
  if (JUNK_TITLE.test(title) || title.toLowerCase() === station.trim().toLowerCase()) return { title: null };
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
  if (!m) return { title };
  // Classical stations put the quoted piece first: "Xerxes: Largo" - Handel - I Solisti Italiani.
  const quoted = /^["“](.+)["”]$/.exec(m[1]!.trim());
  return quoted ? { title, artist: m[2]!.trim(), song: quoted[1]!.trim() } : { title, artist: m[1]!.trim(), song: m[2]!.trim() };
}

const norm = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
const sameArtist = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
const artCache = new Map<string, { at: number; url: Promise<string | undefined> }>();
const ART_MS = 24 * 3_600_000;

/** An album cover for the song, from the free iTunes Search API, then Deezer's; kept a day, also when none was found. */
export function coverArt(artist: string, song: string): Promise<string | undefined> {
  const key = `${norm(artist)}|${norm(song)}`;
  const hit = artCache.get(key);
  if (hit && Date.now() - hit.at < ART_MS) return hit.url;
  const url = (async () => {
    const ask = async <T,>(address: string) => { try { const r = await outboundFetch(address, { timeoutMs: 6000, headers: { 'User-Agent': 'virtuallyView' } }); return r.ok ? await r.json() as T : null; } catch { return null; } };
    const itunes = await ask<{ results?: Array<{ artistName?: string; artworkUrl100?: string }> }>(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${song}`, entity: 'song', limit: '5' })}`);
    let found = itunes?.results?.find(r => r.artworkUrl100 && sameArtist(r.artistName ?? '', artist))?.artworkUrl100?.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/600x600bb.jpg');
    if (!found) {
      const deezer = await ask<{ data?: Array<{ artist?: { name?: string }; album?: { cover_xl?: string } }> }>(`https://api.deezer.com/search?${new URLSearchParams({ q: `artist:"${artist}" track:"${song}"`, limit: '3' })}`);
      found = deezer?.data?.find(d => d.album?.cover_xl && sameArtist(d.artist?.name ?? '', artist))?.album?.cover_xl;
    }
    const served = artProxyUrl(found);
    return served.startsWith('/api/art') ? served : undefined;
  })();
  artCache.set(key, { at: Date.now(), url });
  if (artCache.size > 2000) artCache.delete(artCache.keys().next().value!); // newest 2000 songs
  return url;
}

const nowCache = new Map<string, { at: number; value: Promise<NowPlaying> }>();
/** Artist, song and cover for what a station plays now; asked of the station at most every 20 seconds. */
export function nowPlayingInfo(id: string, station: { url: string; name: string }): Promise<NowPlaying> {
  const hit = nowCache.get(id);
  if (hit && Date.now() - hit.at < 20_000) return hit.value;
  const value = (async () => {
    const parts = splitTitle(await nowPlaying(station.url), station.name);
    const art = parts.artist && parts.song ? await coverArt(parts.artist, parts.song) : undefined;
    return { ...parts, ...(art ? { art } : {}) };
  })();
  nowCache.set(id, { at: Date.now(), value });
  if (nowCache.size > 500) nowCache.delete(nowCache.keys().next().value!);
  return value;
}

// ---- A station's audio as one byte stream, for the timeshift buffer and recordings. Fetched here (every address and
// redirect checked by safeFetch) and piped into ffmpeg, so ffmpeg itself never opens a connection.

export interface RadioSource { /** The station's content type, or "hls" for a segmented stream. */ type: string; chunks: AsyncIterable<Uint8Array> }
const AUDIO_HEADERS = { 'User-Agent': 'virtuallyView', Accept: 'audio/*,*/*' };
const pause = (ms: number, signal: AbortSignal) => new Promise<void>(done => { const t = setTimeout(done, ms); signal.addEventListener('abort', () => { clearTimeout(t); done(); }, { once: true }); });
const playlistRefs = (text: string, base: string) => text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => new URL(l, base).toString());

/** Reconnects when a plain stream drops, five tries in a row at most. */
async function* plainChunks(first: Response, url: string, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  let res: Response | null = first;
  for (let misses = 0; misses < 5 && !signal.aborted;) {
    try {
      res ??= await safeFetch(url, { signal, headers: AUDIO_HEADERS });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) { misses = 0; yield chunk; }
    } catch { /* dropped: try again */ }
    res = null;
    await pause(2000 * ++misses, signal);
  }
}

/** A live HLS stream as one stream of its segments' bytes (MPEG-TS and AAC segments join end to end). */
async function* hlsChunks(text: string, base: string, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  let playlist = text, at = base;
  for (let depth = 0; depth < 2 && /#EXT-X-STREAM-INF/.test(playlist); depth++) {
    const res = await safeFetch(playlistRefs(playlist, at)[0]!, { signal, headers: AUDIO_HEADERS });
    at = res.url || playlistRefs(playlist, at)[0]!; playlist = await res.text();
  }
  if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(playlist)) throw new Error('encrypted');
  const seen = new Set<string>();
  let first = true, misses = 0, init = false;
  while (!signal.aborted && misses < 5) {
    const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist)?.[1];
    if (map && !init) { const r = await safeFetch(new URL(map, at).toString(), { signal, headers: AUDIO_HEADERS }); yield new Uint8Array(await r.arrayBuffer()); init = true; }
    const fresh = playlistRefs(playlist, at).filter(u => !seen.has(u));
    // Join near the live edge, not at the start of the station's own window.
    for (const u of first ? fresh.slice(-2) : fresh) {
      try { const r = await safeFetch(u, { signal, headers: AUDIO_HEADERS }); if (r.ok) yield new Uint8Array(await r.arrayBuffer()); } catch { if (signal.aborted) return; }
    }
    for (const u of fresh) { seen.add(u); if (seen.size > 2000) seen.delete(seen.values().next().value!); }
    if (/#EXT-X-ENDLIST/.test(playlist) && !fresh.length) return;
    first = false;
    await pause(Math.max(1, Number(/#EXT-X-TARGETDURATION:(\d+)/.exec(playlist)?.[1]) || 6) * 500, signal);
    try {
      const res = await safeFetch(at, { signal, headers: AUDIO_HEADERS });
      if (res.ok) { playlist = await res.text(); misses = 0; } else misses++;
    } catch { misses++; }
  }
}

/** Opens the station. Throws when it does not answer, or when its stream cannot be joined into one (encrypted HLS). */
export async function openSource(url: string, signal: AbortSignal): Promise<RadioSource> {
  const res = await safeFetch(url, { signal, headers: AUDIO_HEADERS });
  if (!res.ok || !res.body) { void res.body?.cancel(); throw new Error(`The station answered ${res.status}. It may be off the air.`); }
  const type = res.headers.get('content-type') ?? '';
  if (/mpegurl/i.test(type) || /\.m3u8?(\?|$)/i.test(url)) {
    const text = await res.text();
    if (/#EXT-X-KEY:METHOD=(?!NONE)/.test(text)) throw new Error('This station encrypts its stream, so it cannot be paused.');
    return { type: 'hls', chunks: hlsChunks(text, res.url || url, signal) };
  }
  return { type, chunks: plainChunks(res, url, signal) };
}

/** What the station says is playing right now (its ICY title), read from a short second connection. */
export async function nowPlaying(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await safeFetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'virtuallyView' }, signal: controller.signal });
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
