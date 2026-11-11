import { statfs } from 'node:fs/promises';
import path from 'node:path';
import { all, get } from '../db/app-db.js';
import { DATA_DIR } from '../lib/paths.js';
import { getAdapter } from './registry.js';
import { getServerSettings } from './server-settings.js';
import { measureRoot } from './storage.js';
import { videosLibrary } from './video-lists.js';
import { notify } from './notifications.js';

const GB = 1024 ** 3;
/** Always keep this much free: a full disk once stopped every service. */
export const SAFETY_MARGIN = 10 * GB;
export const SUGGEST_DAYS = 90;

const gb = (bytes: number) => `${bytes >= 10 * GB ? Math.round(bytes / GB) : Math.round(bytes / GB * 10) / 10} GB`;

/** Free space on the disk holding `dir`, or null when it cannot be read (then nothing is blocked). */
export async function freeBytesAt(dir: string): Promise<number | null> {
  try { const s = await statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/** Can a download of `sizeBytes` (0 = not known yet) start? Blocks when it would eat into the safety margin. */
export function spaceCheck(freeBytes: number | null, sizeBytes: number): { ok: true } | { ok: false; message: string } {
  if (freeBytes === null) return { ok: true };
  if (sizeBytes > 0) {
    return sizeBytes <= freeBytes - SAFETY_MARGIN ? { ok: true } : { ok: false, message: `Not enough space for this ${gb(sizeBytes)} file: ${gb(freeBytes)} free.` };
  }
  return freeBytes > SAFETY_MARGIN ? { ok: true } : { ok: false, message: `Not enough space to start a download: ${gb(freeBytes)} free.` };
}

/** The disk that downloads land on. */
export const downloadsFree = () => freeBytesAt(getServerSettings().mediaRoots.staging || '/downloads');

export const isLowSpace = (freeBytes: number, totalBytes: number) => freeBytes < 20 * GB || (totalBytes > 0 && freeBytes < totalBytes * 0.1);

export type Category = 'movies' | 'tv' | 'music' | 'videos' | 'downloads' | 'cache' | 'backups';
const LABELS: Record<Category, string> = { movies: 'Movies', tv: 'TV shows', music: 'Music', videos: 'Videos', downloads: 'Downloads in progress', cache: 'Offline and transcode cache', backups: 'Backups' };

/** Add up folder sizes per category, biggest first; empty categories are left out. */
export function categorize(parts: Array<{ category: Category; bytes: number }>): Array<{ id: Category; label: string; bytes: number }> {
  const sums = new Map<Category, number>();
  for (const p of parts) sums.set(p.category, (sums.get(p.category) ?? 0) + p.bytes);
  return [...sums].filter(([, bytes]) => bytes > 0).map(([id, bytes]) => ({ id, label: LABELS[id], bytes })).sort((a, b) => b.bytes - a.bytes);
}

export interface PlanTitle { id: string; title: string; kind: 'movie' | 'series'; year?: number; bytes: number; quality: string; addedAt: number; needed: number }
/** Per title: how each viewer got on (finished = episodes finished, or 1 for a film), and the latest activity. */
export interface Activity { users: Record<string, { finished: number; partial: boolean }>; lastAt: number }

export const watchedBy = (a?: Activity) => a ? Object.keys(a.users).length : 0;

/** Titles every viewer who touched them has finished, left alone for `days` days, biggest first. */
export function suggest(titles: PlanTitle[], activity: Map<string, Activity>, days: number, now = Date.now()): PlanTitle[] {
  const cutoff = now - days * 86_400_000;
  return titles.filter(t => {
    const a = activity.get(t.id);
    if (!a || t.bytes <= 0 || t.addedAt > cutoff || a.lastAt > cutoff) return false;
    const users = Object.values(a.users);
    return users.length > 0 && users.every(u => !u.partial && u.finished >= Math.max(1, t.needed));
  }).sort((a, b) => b.bytes - a.bytes);
}

function loadActivity(): Map<string, Activity> {
  const map = new Map<string, Activity>();
  const at = (id: string) => { let a = map.get(id); if (!a) map.set(id, a = { users: {}, lastAt: 0 }); return a; };
  const user = (a: Activity, u: string) => (a.users[u] ??= { finished: 0, partial: false });
  const ms = (iso: string) => Date.parse(iso) || 0;
  for (const r of all<{ u: string; id: string; at: string }>("SELECT user_id u, CASE WHEN series_id IS NOT NULL THEN series_id ELSE media_id END id, finished_at at FROM watch_finished WHERE media_type IN ('movie','episode')")) {
    const a = at(r.id); user(a, r.u).finished++; a.lastAt = Math.max(a.lastAt, ms(r.at));
  }
  // A "watched" mark on a whole title counts as finished however many episodes it has.
  for (const r of all<{ u: string; id: string; at: string }>("SELECT user_id u, media_id id, updated_at at FROM user_flags WHERE watched = 1 AND media_type IN ('movie','series')")) {
    const a = at(r.id); user(a, r.u).finished = Number.MAX_SAFE_INTEGER; a.lastAt = Math.max(a.lastAt, ms(r.at));
  }
  for (const r of all<{ u: string; id: string | null; at: string }>("SELECT user_id u, CASE WHEN media_type = 'episode' THEN context ELSE media_id END id, updated_at at FROM watch_progress WHERE media_type IN ('movie','series','episode')")) {
    if (!r.id) continue;
    const a = at(r.id); user(a, r.u).partial = true; a.lastAt = Math.max(a.lastAt, ms(r.at));
  }
  return map;
}

interface RawItem { id: string; title: string; year?: number; quality?: string; createdAt?: Date | string; fileInfo?: { size?: number }; sizeOnDisk?: number; seasons?: Array<{ availableEpisodes?: number }> }

async function loadTitles(): Promise<PlanTitle[]> {
  const out: PlanTitle[] = [];
  const read = async (key: string, kind: PlanTitle['kind']) => {
    try {
      for (const m of await getAdapter(key).getItems() as unknown as RawItem[]) {
        const bytes = kind === 'movie' ? m.fileInfo?.size ?? 0 : m.sizeOnDisk ?? 0;
        if (bytes <= 0) continue;
        const needed = kind === 'movie' ? 1 : (m.seasons ?? []).reduce((n, s) => n + (s.availableEpisodes ?? 0), 0);
        out.push({ id: m.id, title: m.title, kind, year: m.year, bytes, quality: m.quality ?? '', addedAt: m.createdAt ? Date.parse(String(m.createdAt)) || 0 : 0, needed });
      }
    } catch { /* that service is offline: its titles are left out */ }
  };
  await Promise.all([read('radarr', 'movie'), read('sonarr', 'series')]);
  return out;
}

export interface Disk { name: string; path: string; totalBytes: number; freeBytes: number; usedBytes: number }
export interface Plan {
  scannedAt: string | null;
  categories: ReturnType<typeof categorize>;
  biggest: Array<PlanTitle & { watched: boolean }>;
  suggestions: Array<PlanTitle & { lastWatched: string | null }>;
  days: number;
}

function folders(): Array<{ category: Category; dir: string }> {
  const s = getServerSettings().mediaRoots;
  return ([
    { category: 'movies', dir: s.movies || '/media/movies' }, { category: 'tv', dir: s.tv || '/media/tv' }, { category: 'music', dir: s.music || '/media/music' },
    { category: 'videos', dir: videosLibrary() }, { category: 'downloads', dir: s.staging || '/downloads' },
    { category: 'cache', dir: path.join(DATA_DIR, 'offline') }, { category: 'cache', dir: path.join(DATA_DIR, 'trickplay') }, { category: 'backups', dir: path.join(DATA_DIR, 'backups') }
  ] as Array<{ category: Category; dir: string }>).map(f => ({ ...f, dir: path.resolve(f.dir) }));
}

/** Free and used space for each configured folder plus the app data folder. Cheap, so it is read live. */
export async function disks(): Promise<Disk[]> {
  const names: Record<string, string> = { movies: 'Movies', tv: 'TV shows', music: 'Music', videos: 'Videos', downloads: 'Downloads' };
  const list = [...folders().filter(f => names[f.category]).map(f => ({ name: names[f.category], dir: f.dir })), { name: 'App data', dir: DATA_DIR }];
  const out: Disk[] = [];
  for (const f of list) {
    try {
      const s = await statfs(f.dir);
      const totalBytes = Number(s.blocks) * Number(s.bsize), freeBytes = Number(s.bavail) * Number(s.bsize);
      out.push({ name: f.name, path: f.dir, totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) });
    } catch { /* not mounted here */ }
  }
  return out;
}

let cached: (Omit<Plan, 'days' | 'suggestions'> & { all: PlanTitle[]; activity: Map<string, Activity> }) | null = null;
let scanning: Promise<void> | null = null;

/** Measure everything in the background. The page reads the last result and never waits for this. */
export function refreshPlan(): Promise<void> {
  scanning ??= (async () => {
    const sizes = await Promise.all(folders().map(async f => ({ category: f.category, bytes: (await measureRoot(f.dir)).bytes })));
    const titles = await loadTitles();
    const activity = loadActivity();
    cached = {
      scannedAt: new Date().toISOString(), categories: categorize(sizes), all: titles, activity,
      biggest: titles.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 20).map(t => ({ ...t, watched: watchedBy(activity.get(t.id)) > 0 }))
    };
  })().catch(() => undefined).finally(() => { scanning = null; });
  return scanning;
}

export function getPlan(days = SUGGEST_DAYS): Plan & { scanning: boolean } {
  if (!cached || Date.now() - Date.parse(cached.scannedAt ?? '') > 10 * 60_000) void refreshPlan();
  if (!cached) return { scannedAt: null, categories: [], biggest: [], suggestions: [], days, scanning: true };
  const c = cached;
  const suggestions = suggest(c.all, c.activity, days).map(t => ({ ...t, lastWatched: c.activity.get(t.id)?.lastAt ? new Date(c.activity.get(t.id)!.lastAt).toISOString() : null }));
  return { scannedAt: c.scannedAt, categories: c.categories, biggest: c.biggest, suggestions, days, scanning: !!scanning };
}

/** A title was deleted: drop it from the last result now, and re-measure in the background. */
export function forgetTitle(id: string): void {
  if (cached) cached = { ...cached, all: cached.all.filter(t => t.id !== id), biggest: cached.biggest.filter(t => t.id !== id) };
  void refreshPlan();
}

/** Tell the admins when a disk is running out: below 10% or 20 GB, at most once a day (also across restarts). */
export async function warnIfLow(): Promise<void> {
  const low = (await disks()).filter(d => isLowSpace(d.freeBytes, d.totalBytes)).sort((a, b) => a.freeBytes - b.freeBytes)[0];
  if (!low) return;
  const last = get<{ created_at: string }>("SELECT created_at FROM notifications WHERE type = 'storage.low' ORDER BY id DESC LIMIT 1");
  if (last && Date.now() - Date.parse(last.created_at) < 86_400_000) return;
  notify({ type: 'storage.low', role: 'admin', title: `Low disk space: ${gb(low.freeBytes)} free`, body: `${low.name} (${low.path}) is nearly full. Open Settings, Storage to free some space.`, link: '/settings?s=storage' });
}

export function startStoragePlanner(): void {
  const tick = () => { void warnIfLow().catch(() => undefined); void refreshPlan(); };
  setTimeout(tick, 90_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}
