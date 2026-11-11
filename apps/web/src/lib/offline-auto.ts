import { useEffect } from 'react';
import { api } from './api';
import { enqueue, episodeMeta } from './offline-queue';
import { keepNextPlan, lastQuality } from './offline-plan';
import { deleteSaved, keyFor, listSaved, localProgressFor, syncProgress } from './offline-store';

// "Keep the next N episodes on this device", chosen per series. It runs when the app opens online and every
// few minutes while it stays open; there is no background sync.

const KEY = 'vv-offline-keep';
export const KEEP_COUNT = 3;
const EVERY_MS = 5 * 60_000;

interface Keep { title: string; count: number }

function read(): Record<string, Keep> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Keep>; } catch { return {}; }
}

export const keepEnabled = (seriesId: string) => !!read()[seriesId];

export function setKeep(seriesId: string, title: string, on: boolean): void {
  const all = read();
  if (on) all[seriesId] = { title, count: KEEP_COUNT }; else delete all[seriesId];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked */ }
  if (on) void runAutoDownloads();
}

let busy = false;

/** One pass: send offline progress, then for each chosen series delete what was watched and queue the next few. */
export async function runAutoDownloads(): Promise<void> {
  const chosen = Object.entries(read());
  if (busy || chosen.length === 0 || navigator.onLine === false) return;
  busy = true;
  try {
    await syncProgress().catch(() => 0);
    for (const [seriesId, keep] of chosen) {
      try {
        const { episodes } = await api.serieEpisodes(seriesId);
        const ordered = [...episodes].sort((a, b) => (a.seasonNumber || 999) - (b.seasonNumber || 999) || a.episodeNumber - b.episodeNumber);
        const onDevice = (await listSaved()).filter(i => i.kind === 'episode' && i.seriesId === seriesId);
        const watched = new Set<string>();
        for (const ep of ordered) {
          const local = await localProgressFor('episode', ep.id).catch(() => undefined);
          if (ep.watched || (local && local.durationSeconds > 0 && local.positionSeconds >= local.durationSeconds * 0.9)) watched.add(ep.id);
        }
        const plan = keepNextPlan(ordered.map(e => ({ id: e.id, hasFile: e.hasFile, watched: watched.has(e.id) })), new Set(onDevice.map(i => i.id)), keep.count);
        for (const id of plan.remove) await deleteSaved(keyFor('episode', id));
        const byId = new Map(ordered.map(e => [e.id, e]));
        await enqueue(plan.fetch.map(id => episodeMeta(byId.get(id)!, keep.title, lastQuality())));
      } catch { /* this series is tried again next time */ }
    }
  } finally {
    busy = false;
  }
}

/** Mounted once in the app: runs on open and then every few minutes. */
export function useAutoDownloads(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void runAutoDownloads();
    const timer = window.setInterval(() => { void runAutoDownloads(); }, EVERY_MS);
    const onOnline = () => { void runAutoDownloads(); };
    window.addEventListener('online', onOnline);
    return () => { window.clearInterval(timer); window.removeEventListener('online', onOnline); };
  }, [enabled]);
}
