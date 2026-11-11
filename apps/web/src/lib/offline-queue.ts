import { useSyncExternalStore } from 'react';
import type { EpisodeItem } from './api';
import { getSaved, keyFor, saveForOffline, spaceWarning } from './offline-store';
import { estimateBytes, type OfflineQuality } from './offline-plan';

// A queue of downloads that run one after another (a whole season, or "keep the next 3"). The server also
// converts one at a time, so asking for a season never floods it. Pause stops starting new items.

type Meta = Parameters<typeof saveForOffline>[0];
export interface QueueJob { meta: Meta; status: 'queued' | 'saving' | 'done' | 'failed'; percent: number; error?: string }
export interface QueueState { jobs: QueueJob[]; paused: boolean }

let state: QueueState = { jobs: [], paused: false };
let running = false;
const listeners = new Set<() => void>();

function set(next: QueueState) { state = next; listeners.forEach(l => l()); }
function patch(index: number, change: Partial<QueueJob>) {
  set({ ...state, jobs: state.jobs.map((j, i) => (i === index ? { ...j, ...change } : j)) });
}

export function useQueue(): QueueState {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state);
}

/** The details a saved episode needs, from the episode list of its series. */
export function episodeMeta(ep: EpisodeItem, seriesTitle: string | undefined, quality: OfflineQuality): Meta {
  return {
    kind: 'episode', id: ep.id, title: ep.title || `Episode ${ep.episodeNumber}`, subtitle: seriesTitle,
    seriesId: ep.seriesId, durationSeconds: ep.runtime ? ep.runtime * 60 : null, quality
  };
}

/** Adds items that are not already saved or waiting, and starts working through them. */
export async function enqueue(metas: Meta[]): Promise<void> {
  const fresh: QueueJob[] = [];
  for (const meta of metas) {
    if (state.jobs.some(j => j.meta.kind === meta.kind && j.meta.id === meta.id && j.status !== 'failed' && j.status !== 'done')) continue;
    if (await getSaved(keyFor(meta.kind, meta.id)).catch(() => undefined)) continue;
    fresh.push({ meta, status: 'queued', percent: 0 });
  }
  if (fresh.length === 0) return;
  // A finished batch is forgotten when a new one starts.
  const keep = state.jobs.some(j => j.status === 'queued' || j.status === 'saving') ? state.jobs : [];
  set({ jobs: [...keep, ...fresh], paused: false });
  void pump();
}

export function setPaused(paused: boolean): void {
  set({ ...state, paused });
  if (!paused) void pump();
}

export function clearQueue(): void {
  if (!running) set({ jobs: [], paused: false });
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      if (state.paused) return;
      const index = state.jobs.findIndex(j => j.status === 'queued');
      if (index < 0) return;
      const { meta } = state.jobs[index];
      patch(index, { status: 'saving', percent: 0 });
      try {
        const warning = await spaceWarning(estimateBytes(meta.durationSeconds, meta.quality ?? 'standard'));
        if (warning) throw new Error(warning);
        await saveForOffline(meta, p => patch(index, { percent: p.phase === 'preparing' ? Math.round(p.percent / 2) : 50 + Math.round(p.percent / 2) }));
        patch(index, { status: 'done', percent: 100 });
      } catch (err) {
        patch(index, { status: 'failed', error: (err as Error).message || 'This could not be saved.' });
      }
    }
  } finally {
    running = false;
  }
}

/** Overall progress across the whole batch, 0 to 100. */
export function overallPercent(jobs: QueueJob[]): number {
  if (jobs.length === 0) return 0;
  return Math.round(jobs.reduce((sum, j) => sum + (j.status === 'done' || j.status === 'failed' ? 100 : j.percent), 0) / jobs.length);
}
