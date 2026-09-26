import { existsSync, statfsSync } from 'node:fs';
import type { ProwlarrAdapter, QBittorrentAdapter } from '@virtuallyview/integrations';
import { getAdapter, loadServiceConfig } from './registry.js';
import { getMediaRoots } from './media-roots.js';
import { getDownloads } from './real-downloads.js';
import { listApps } from './homelab-apps.js';
import { internetReachable, watchtowerPresent } from './auto-update.js';
import { youtubeAvailable } from './youtube.js';
import { helperStatus } from './host-helper.js';

/**
 * "Something is not working": look at the whole stack, say in plain words what is wrong,
 * what to try, and offer a restart when the optional helper is there. Read-only: nothing here
 * changes anything, and no address, key or file path is put in the answer.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped';
export interface Check {
  id: string;
  area: 'Internet' | 'Search' | 'Downloads' | 'Media' | 'Apps' | 'Extras';
  label: string;
  status: CheckStatus;
  detail: string;
  /** What to try, in order. */
  fixes: string[];
  /** A service the helper can restart to try to fix this. */
  restart?: string;
}

const check = (c: Check): Check => c;
const bounded = <T>(work: Promise<T>, ms = 6000): Promise<T> => Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);

async function head(url: string, ms = 5000): Promise<boolean> {
  try { await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(ms) }); return true; } catch { return false; }
}

async function arrGet(key: string, path: string): Promise<unknown | null> {
  const entry = loadServiceConfig()[key];
  if (!entry?.url || entry.enabled === false) return null;
  try {
    const res = await fetch(`${entry.url.replace(/\/$/, '')}${path}`, { headers: { 'X-Api-Key': entry.apiKey }, signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const ARRS: Array<{ key: 'radarr' | 'sonarr' | 'lidarr'; label: string; v: string }> = [
  { key: 'radarr', label: 'Movies (Radarr)', v: 'v3' }, { key: 'sonarr', label: 'TV (Sonarr)', v: 'v3' }, { key: 'lidarr', label: 'Music (Lidarr)', v: 'v1' }
];

async function internetChecks(): Promise<Check[]> {
  const online = await internetReachable();
  const out: Check[] = [check({
    id: 'internet', area: 'Internet', label: 'Internet access', status: online ? 'ok' : 'fail',
    detail: online ? 'The server can reach the internet.' : 'The server cannot reach the internet. Downloads, searches, posters and updates all need it.',
    fixes: online ? [] : ['Check that the computer running virtuallyView is online.', 'If you use a VPN on that computer, make sure it is connected.', 'Restart the server\'s network, then run these checks again.']
  })];
  if (!online) return out;
  const [tmdb, mb] = await Promise.all([head('https://www.themoviedb.org/'), head('https://musicbrainz.org/')]);
  out.push(check({
    id: 'metadata', area: 'Internet', label: 'Posters, cast and music info', status: tmdb && mb ? 'ok' : 'warn',
    detail: tmdb && mb ? 'The sites that provide posters, cast lists and music details answer.' : `${!tmdb ? 'The movie database (TMDB) does not answer. ' : ''}${!mb ? 'MusicBrainz does not answer. ' : ''}Posters, cast and artist details may be missing.`,
    fixes: tmdb && mb ? [] : ['This is often temporary: try again in a few minutes.', 'If it keeps failing, your network may block those sites, or the outbound proxy in Settings > Server may be wrong.']
  }));
  return out;
}

async function searchChecks(): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const indexers = await bounded(getAdapter<ProwlarrAdapter>('prowlarr').listIndexers());
    const enabled = indexers.filter(i => i.enabled);
    const working = enabled.filter(i => !i.failingUntil);
    const status: CheckStatus = enabled.length === 0 ? 'fail' : working.length === 0 ? 'fail' : working.length < Math.max(2, enabled.length * 0.25) ? 'warn' : 'ok';
    out.push(check({
      id: 'sources', area: 'Search', label: 'Places to search for downloads', status,
      detail: enabled.length === 0 ? 'No search source is turned on, so nothing can be found.' : `${working.length} of ${enabled.length} search sources are answering.`,
      fixes: status === 'ok' ? [] : ['Open Settings > Indexers and add or enable more sources (Internet Archive and Linux distributions work without an account).',
        'Sources that keep failing usually recover by themselves; a search across many can take a minute.', 'If none work, restart Prowlarr with the button.'],
      ...(status !== 'ok' ? { restart: 'prowlarr' } : {})
    }));
  } catch {
    out.push(check({ id: 'sources', area: 'Search', label: 'Places to search for downloads', status: 'fail', detail: 'Prowlarr, which searches for downloads, does not answer.', fixes: ['Restart Prowlarr with the button, then run the checks again.', 'If it stays down, run "docker compose up -d" on the server.'], restart: 'prowlarr' }));
  }
  const flare = process.env.FLARESOLVERR_URL ?? 'http://flaresolverr:8191';
  const flareUp = await head(flare, 3000);
  out.push(check({
    id: 'flaresolverr', area: 'Search', label: 'Cloudflare helper for search sources', status: flareUp ? 'ok' : 'warn',
    detail: flareUp ? 'The helper that gets past Cloudflare checks is running.' : 'The Cloudflare helper (FlareSolverr) is not running, so search sources behind Cloudflare (1337x, EZTV and others) fail.',
    fixes: flareUp ? [] : ['Restart it with the button, or run "docker compose up -d flaresolverr".'], ...(flareUp ? {} : { restart: 'flaresolverr' })
  }));
  return out;
}

async function downloadChecks(): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const qbit = getAdapter<QBittorrentAdapter>('qbittorrent');
    const conn = await bounded(qbit.connectionStatus());
    out.push(check({
      id: 'download-client', area: 'Downloads', label: 'Download client and its network', status: conn.status === 'connected' ? 'ok' : conn.status === 'firewalled' ? 'warn' : 'fail',
      detail: conn.status === 'connected' ? 'qBittorrent is connected to the network.' : conn.status === 'firewalled' ? 'qBittorrent is running but other people cannot connect to it (normal behind a VPN). Downloads still work.' : 'qBittorrent has no network connection. If you use the built-in VPN, the tunnel is probably down.',
      fixes: conn.status === 'disconnected' ? ['Restart the VPN with the button (free VPN relays come and go; a new one is picked automatically), then restart qBittorrent.', 'Wait a minute and run the checks again.', 'If it keeps failing, see Settings > VPN to pick another provider or country.'] : [],
      ...(conn.status === 'disconnected' ? { restart: 'gluetun' } : {})
    }));
  } catch {
    out.push(check({ id: 'download-client', area: 'Downloads', label: 'Download client and its network', status: 'fail', detail: 'qBittorrent does not answer.', fixes: ['Restart qBittorrent with the button.', 'If it does not start, restart the VPN first, then qBittorrent (they share a network).'], restart: 'qbittorrent' }));
  }
  for (const arr of ARRS) {
    const clients = await arrGet(arr.key, `/api/${arr.v}/downloadclient`) as Array<{ enable?: boolean }> | null;
    const indexers = await arrGet(arr.key, `/api/${arr.v}/indexer`) as unknown[] | null;
    if (clients === null) { out.push(check({ id: `wiring-${arr.key}`, area: 'Downloads', label: `${arr.label} connections`, status: 'fail', detail: `${arr.label} does not answer.`, fixes: [`Restart ${arr.label.split(' ')[1]!.replace(/[()]/g, '')} with the button.`, 'Then run "Set up for me" again from Home if it still fails.'], restart: arr.key })); continue; }
    const hasClient = clients.some(c => c.enable !== false);
    const hasIndexers = (indexers?.length ?? 0) > 0;
    out.push(check({
      id: `wiring-${arr.key}`, area: 'Downloads', label: `${arr.label} connections`, status: hasClient && hasIndexers ? 'ok' : 'fail',
      detail: !hasClient ? 'It has no download client, so it cannot download anything.' : !hasIndexers ? 'It has no search sources, so it cannot find anything.' : 'It is connected to a download client and to search sources.',
      fixes: hasClient && hasIndexers ? [] : ['Run "Set up for me" from Home: it connects everything automatically.', 'Or run "docker compose run --rm provision" on the server.']
    }));
  }
  try {
    const rows = await bounded(getDownloads(), 8000);
    const stalled = rows.filter(r => r.status === 'stalled').length;
    const failed = rows.filter(r => r.status === 'failed').length;
    out.push(check({
      id: 'stuck-downloads', area: 'Downloads', label: 'Stuck downloads', status: stalled + failed === 0 ? 'ok' : 'warn',
      detail: stalled + failed === 0 ? 'Nothing is stuck.' : `${stalled} stalled and ${failed} failed download${stalled + failed === 1 ? '' : 's'}.`,
      fixes: stalled + failed === 0 ? [] : ['Open Downloads and press "Try another release" on stalled ones: it blocks that release and searches again.', 'For anything that never finds a release, open the request and use "Find a release myself".']
    }));
  } catch { /* the download list is checked elsewhere */ }
  return out;
}

async function mediaChecks(): Promise<Check[]> {
  const out: Check[] = [];
  const roots = getMediaRoots();
  const missing = roots.filter(r => !existsSync(r));
  out.push(check({
    id: 'folders', area: 'Media', label: 'Media folders', status: missing.length ? 'fail' : 'ok',
    detail: missing.length ? `${missing.length} media folder${missing.length === 1 ? ' is' : 's are'} not visible to the dashboard, so files there cannot be played.` : 'The movie, TV and music folders are visible.',
    fixes: missing.length ? ['Open Settings > Media folders and check the paths.', 'If you use your own folders, make sure they are shared with the dashboard in docker-compose.yml.'] : []
  }));
  let lowest = Infinity;
  for (const root of roots) { try { const s = statfsSync(root); lowest = Math.min(lowest, (s.bavail * s.bsize) / 1e9); } catch { /* not there */ } }
  if (Number.isFinite(lowest)) {
    out.push(check({
      id: 'disk', area: 'Media', label: 'Free disk space', status: lowest < 2 ? 'fail' : lowest < 15 ? 'warn' : 'ok',
      detail: `${Math.round(lowest)} GB free where the media lives.`,
      fixes: lowest < 15 ? ['Delete downloads you no longer need (Downloads > Delete files).', 'Move the library to a bigger disk (Settings > Media folders).', 'Lower the default quality in Settings so new downloads are smaller.'] : []
    }));
  }
  return out;
}

async function appChecks(): Promise<Check[]> {
  const out: Check[] = [];
  try {
    for (const app of await bounded(listApps(), 8000)) {
      if (!app.connected) continue;
      out.push(check({
        id: `app-${app.id}`, area: 'Apps', label: app.name, status: app.healthy ? 'ok' : 'fail',
        detail: app.healthy ? `${app.name} is answering.${app.headline ? ` ${app.headline}` : ''}` : `${app.name} is not answering.`,
        fixes: app.healthy ? [] : [`Restart ${app.name} with the button.`, `Check its address in Apps: ${app.name} listens on port ${app.port}.`, app.hasKey ? 'If it answers but shows as offline, the saved key may have changed: save it again on the Apps page.' : `${app.keyHelp}`],
        ...(app.healthy ? {} : { restart: app.id === 'immich' ? 'immich-server' : app.id })
      }));
    }
  } catch { /* no apps configured */ }
  return out;
}

async function extraChecks(): Promise<Check[]> {
  const out: Check[] = [];
  const helper = await helperStatus();
  out.push(check({
    id: 'helper', area: 'Extras', label: 'Restart helper', status: helper.ok ? 'ok' : 'skipped',
    detail: helper.ok ? 'The helper is on, so the Restart buttons here work.' : 'The optional helper is off, so Restart buttons cannot work; restart from the server instead.',
    fixes: helper.ok ? [] : ['To turn it on: run "docker compose --profile helper up -d" on the server.']
  }));
  if (process.env.YTDLP_URL) {
    const up = await youtubeAvailable();
    out.push(check({ id: 'youtube', area: 'Extras', label: 'YouTube downloads', status: up ? 'ok' : 'skipped', detail: up ? 'The YouTube service is running.' : 'YouTube downloads are turned off.', fixes: up ? [] : ['To turn them on: run "docker compose --profile youtube up -d".'], ...(up ? {} : {}) }));
  }
  if (process.env.WATCHTOWER_URL) {
    const up = await watchtowerPresent({});
    out.push(check({ id: 'updates', area: 'Extras', label: 'Automatic updates', status: up ? 'ok' : 'skipped', detail: up ? 'Automatic updates are on.' : 'Automatic updates are off (they are optional).', fixes: up ? [] : ['To turn them on: run "docker compose --profile auto-update up -d". See docs/updates.md.'] }));
  }
  return out;
}

export async function runTroubleshooting(): Promise<{ checkedAt: string; checks: Check[]; summary: { ok: number; warn: number; fail: number } }> {
  const groups = await Promise.all([internetChecks(), searchChecks(), downloadChecks(), mediaChecks(), appChecks(), extraChecks()].map(p => p.catch(() => [] as Check[])));
  const checks = groups.flat();
  return { checkedAt: new Date().toISOString(), checks, summary: {
    ok: checks.filter(c => c.status === 'ok').length, warn: checks.filter(c => c.status === 'warn').length, fail: checks.filter(c => c.status === 'fail').length
  } };
}

/** Restarts only what the helper is allowed to (it enforces its own list); the name is the compose service. */
export const RESTARTABLE = new Set(['radarr', 'sonarr', 'lidarr', 'prowlarr', 'bazarr', 'qbittorrent', 'flaresolverr', 'gluetun', 'ollama', 'kiwix', 'audiobookshelf', 'kavita', 'immich-server', 'ytdlp']);
