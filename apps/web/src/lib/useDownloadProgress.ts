import { useEffect, useState } from 'react';
import { api, type DownloadItem } from './api';

/** What a title's downloads look like right now, merged when a show downloads several episodes. */
export interface TitleDownload {
  state: 'downloading' | 'importing' | 'queued' | 'paused' | 'failed';
  progress: number;
  count: number;
  eta?: string;
  speed?: string;
  message?: string;
}

const ACTIVE_MS = 4000;
const IDLE_MS = 20000;
const RANK: Record<TitleDownload['state'], number> = { downloading: 5, importing: 4, queued: 3, paused: 2, failed: 1 };

let snapshot = new Map<string, TitleDownload>();
const listeners = new Set<(next: Map<string, TitleDownload>) => void>();
let timer: number | null = null;

function toState(status: string): TitleDownload['state'] | null {
  if (status === 'downloading' || status === 'importing' || status === 'queued' || status === 'paused' || status === 'failed') return status;
  return null;
}

export function summarise(rows: DownloadItem[]): Map<string, TitleDownload> {
  const grouped = new Map<string, DownloadItem[]>();
  for (const row of rows) {
    if (!row.mediaId || !toState(row.status)) continue;
    grouped.set(row.mediaId, [...(grouped.get(row.mediaId) ?? []), row]);
  }
  const out = new Map<string, TitleDownload>();
  for (const [id, list] of grouped) {
    const lead = [...list].sort((a, b) => RANK[toState(b.status)!] - RANK[toState(a.status)!])[0]!;
    const state = toState(lead.status)!;
    const counted = list.filter(r => r.status !== 'failed');
    const progress = counted.length ? counted.reduce((sum, r) => sum + (r.progress || 0), 0) / counted.length : lead.progress || 0;
    out.set(id, {
      state, progress: Math.max(0, Math.min(100, progress)), count: list.length,
      ...(lead.eta ? { eta: lead.eta } : {}), ...(lead.speed ? { speed: lead.speed } : {}), ...(lead.message ? { message: lead.message } : {})
    });
  }
  return out;
}

async function poll() {
  timer = null;
  if (!listeners.size) return;
  if (typeof document !== 'undefined' && document.hidden) { timer = window.setTimeout(poll, IDLE_MS); return; }
  let next = snapshot;
  try { next = summarise(await api.downloads()); } catch { /* services offline: keep the last picture */ }
  snapshot = next;
  for (const listener of listeners) listener(next);
  const busy = [...next.values()].some(d => d.state === 'downloading' || d.state === 'importing' || d.state === 'queued');
  if (listeners.size) timer = window.setTimeout(poll, busy ? ACTIVE_MS : IDLE_MS);
}

function subscribe(listener: (next: Map<string, TitleDownload>) => void) {
  listeners.add(listener);
  if (timer === null) void poll();
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== null) { window.clearTimeout(timer); timer = null; }
  };
}

if (typeof window !== 'undefined') {
  // The top-bar refresh button asks for a fresh look right now.
  window.addEventListener('vv-refresh', () => {
    if (!listeners.size) return;
    if (timer !== null) window.clearTimeout(timer);
    void poll();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && listeners.size) { if (timer !== null) window.clearTimeout(timer); void poll(); }
  });
}

/** Live download state for one title (movie, show or artist id), shared by every card on the page. */
export function useTitleDownload(mediaId: string | undefined): TitleDownload | undefined {
  const [value, setValue] = useState<TitleDownload | undefined>(() => (mediaId ? snapshot.get(mediaId) : undefined));
  useEffect(() => {
    if (!mediaId) return;
    setValue(snapshot.get(mediaId));
    return subscribe(next => setValue(next.get(mediaId)));
  }, [mediaId]);
  return value;
}

/** Every title currently downloading, importing or queued, shared with the same poll as useTitleDownload. */
export function useAllDownloads(): Map<string, TitleDownload> {
  const [value, setValue] = useState(snapshot);
  useEffect(() => subscribe(setValue), []);
  return value;
}

/** "00:12:30" or an ISO time into "12 min left". */
export function timeLeft(eta: string | undefined): string {
  if (!eta) return '';
  let seconds = NaN;
  const clock = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})$/.exec(eta);
  if (clock) seconds = Number(clock[1] ?? 0) * 86400 + Number(clock[2]) * 3600 + Number(clock[3]) * 60 + Number(clock[4]);
  else if (!Number.isNaN(Date.parse(eta))) seconds = (Date.parse(eta) - Date.now()) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 90) return 'less than 2 min left';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} h ${m ? `${m} min ` : ''}left`;
}

export function downloadLabel(d: TitleDownload): string {
  const pct = `${Math.round(d.progress)}%`;
  const many = d.count > 1 ? ` (${d.count} files)` : '';
  switch (d.state) {
    case 'downloading': return `Downloading ${pct}${many}`;
    case 'importing': return 'Adding to library';
    case 'queued': return `Waiting to download${many}`;
    case 'paused': return `Paused at ${pct}`;
    case 'failed': return 'Download failed';
  }
}
