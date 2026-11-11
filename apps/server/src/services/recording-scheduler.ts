import { randomBytes } from 'node:crypto';
import { all, get, run } from '../db/app-db.js';
import { channelById } from './live-tv.js';
import { notify } from './notifications.js';
import { recordingState, recordingsDir, startRecording, stopRecording } from './recordings.js';
import { freeBytesAt, SAFETY_MARGIN } from './storage-planner.js';
import type { Programme } from './epg.js';

// Scheduled recording from the Live TV guide. Rows live in the database, so a restart loses nothing; a timer
// starts each one through the same ffmpeg code as "record now".

export const PAD_BEFORE = 60_000;
export const PAD_AFTER = 3 * 60_000;
export const MAX_PARALLEL = Number(process.env.RECORDING_PARALLEL) || 2;

export type RowState = 'scheduled' | 'recording' | 'done' | 'failed' | 'missed' | 'conflict';
export interface Row { id: string; channel_id: string; channel: string; title: string; sub: string | null; prog_start: number; prog_stop: number; series_id: string | null; state: RowState; message: string | null; recording_id: string | null; created_at: number }
export interface Series { id: string; title: string; channel_id: string | null; channel: string | null; created_at: number }
export interface Airing { channelId: string; channel: string; start: number; stop: number; title: string; sub?: string | undefined }

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const rows = () => all<Row>('SELECT * FROM rec_schedule ORDER BY prog_start, created_at');
const setState = (id: string, state: RowState, message: string | null = null, recordingId?: string): void => {
  run('UPDATE rec_schedule SET state = ?, message = ?, recording_id = COALESCE(?, recording_id) WHERE id = ?', state, message, recordingId ?? null, id);
};
const span = (r: Pick<Row, 'prog_start' | 'prog_stop'>) => [r.prog_start - PAD_BEFORE, r.prog_stop + PAD_AFTER] as const;

/** Which waiting rows would not get a free slot. Running ones keep their slot; the rest are served in start order. */
export function conflictIds(list: Row[], limit = MAX_PARALLEL): Set<string> {
  const live = list.filter(r => r.state === 'recording' || r.state === 'scheduled' || r.state === 'conflict');
  const taken: Array<readonly [number, number]> = [];
  const out = new Set<string>();
  for (const r of [...live.filter(x => x.state === 'recording'), ...live.filter(x => x.state !== 'recording')]) {
    const [s, e] = span(r);
    if (r.state !== 'recording' && taken.filter(([, end]) => end > s).length >= limit) out.add(r.id);
    else taken.push([s, e]);
  }
  return out;
}

/** Same title and episode (sub-title). Without a sub-title only the very same airing counts as a duplicate. */
function duplicate(a: Airing): boolean {
  return rows().some(r => ['scheduled', 'recording', 'done'].includes(r.state) && same(r.title, a.title) &&
    (a.sub ? same(r.sub, a.sub) : !r.sub && r.prog_start === a.start && r.channel_id === a.channelId));
}

export function schedule(a: Airing, now = Date.now(), seriesId: string | null = null): { ok: true; row: Row } | { ok: false; message: string } {
  if (!a.title || a.stop <= a.start) return { ok: false, message: 'That programme has no usable times.' };
  if (a.stop <= now) return { ok: false, message: 'That programme has already finished.' };
  if (duplicate(a)) return { ok: false, message: 'That programme is already scheduled or recorded.' };
  const id = randomBytes(6).toString('hex');
  run('INSERT INTO rec_schedule (id, channel_id, channel, title, sub, prog_start, prog_stop, series_id, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, a.channelId, a.channel, a.title, a.sub ?? null, a.start, a.stop, seriesId, 'scheduled', now);
  return { ok: true, row: get<Row>('SELECT * FROM rec_schedule WHERE id = ?', id)! };
}

export const listSeries = () => all<Series>('SELECT * FROM rec_series ORDER BY created_at');

/** A rule: every future airing with this title, on one channel or (channelId null) on any. */
export function addSeries(title: string, channelId: string | null, channel: string | null, now = Date.now()): Series {
  const old = listSeries().find(s => same(s.title, title) && s.channel_id === channelId);
  if (old) return old;
  const id = randomBytes(6).toString('hex');
  run('INSERT INTO rec_series (id, title, channel_id, channel, created_at) VALUES (?, ?, ?, ?, ?)', id, title, channelId, channel, now);
  return { id, title, channel_id: channelId, channel, created_at: now };
}

export function deleteSeries(id: string): boolean {
  run("DELETE FROM rec_schedule WHERE series_id = ? AND state IN ('scheduled', 'conflict')", id);
  return Number(run('DELETE FROM rec_series WHERE id = ?', id).changes) > 0;
}

/** Guide data arrived: schedule the future airings that a series rule asks for. */
export function matchSeries(guide: Record<string, Programme[]>, nameOf: (channelId: string) => string, now = Date.now()): number {
  let added = 0;
  const rules = listSeries();
  if (!rules.length) return 0;
  for (const [channelId, list] of Object.entries(guide)) {
    for (const p of list) {
      if (p.start <= now) continue;
      const rule = rules.find(s => same(s.title, p.title) && (!s.channel_id || s.channel_id === channelId));
      if (rule && schedule({ channelId, channel: nameOf(channelId), start: p.start, stop: p.stop, title: p.title, sub: p.sub }, now, rule.id).ok) added++;
    }
  }
  return added;
}

export function listSchedule(): Array<Row & { conflict: boolean }> {
  const list = rows();
  const clash = conflictIds(list);
  return list.map(r => ({ ...r, conflict: r.state === 'conflict' || clash.has(r.id) }));
}

/** Cancel a waiting one, stop a running one, or clear a failed or missed one from the list. */
export function cancelSchedule(id: string): boolean {
  const r = get<Row>('SELECT * FROM rec_schedule WHERE id = ?', id);
  if (!r) return false;
  if (r.state === 'recording' && r.recording_id) stopRecording(r.recording_id);
  run('DELETE FROM rec_schedule WHERE id = ?', id);
  return true;
}

let ticking = false;
/** Called every few seconds: settle what finished, mark what was missed, start what is due. */
export async function tick(now = Date.now()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const r of rows().filter(x => x.state === 'recording')) {
      const s = r.recording_id ? recordingState(r.recording_id) : undefined;
      if (s === 'recording') continue;
      if (s === 'failed' || !s) setState(r.id, 'failed', 'The recording did not finish.'); else setState(r.id, 'done');
    }
    for (const r of rows().filter(x => x.state === 'scheduled')) {
      // Off or busy until the programme ended: nothing left to record.
      if (now >= r.prog_stop) { setState(r.id, 'missed', 'The server was not running when this started.'); continue; }
      if (now < r.prog_start - PAD_BEFORE) continue;
      await start(r, now);
    }
  } finally { ticking = false; }
}

async function start(r: Row, now: number): Promise<void> {
  if (rows().filter(x => x.state === 'recording').length >= MAX_PARALLEL) return setState(r.id, 'conflict', `${MAX_PARALLEL} other recordings were already running.`);
  const free = await freeBytesAt(recordingsDir());
  if (free !== null && free < SAFETY_MARGIN) {
    const message = `Not enough free space to record (${Math.round(free / 1024 ** 3)} GB free, ${Math.round(SAFETY_MARGIN / 1024 ** 3)} GB needed).`;
    setState(r.id, 'failed', message);
    notify({ type: 'storage.low', role: 'admin', title: `Could not record "${r.title}"`, body: message, link: '/live?v=recordings' });
    return;
  }
  const channel = await channelById(r.channel_id);
  if (!channel) return setState(r.id, 'failed', 'That channel was taken out of its playlist.');
  const minutes = Math.min(480, Math.ceil((r.prog_stop + PAD_AFTER - now) / 60_000));
  const result = startRecording(channel.url, channel.name, minutes, r.sub ? `${r.title}: ${r.sub}` : r.title);
  if (result.ok) setState(r.id, 'recording', null, result.recording.id); else setState(r.id, 'failed', result.message);
}

/** Start the timer. `refresh` (optional) asks for fresh guide data so series rules keep finding new airings. */
export function startScheduler(refresh?: () => Promise<void>): void {
  const loop = () => void tick().catch(() => undefined);
  loop();
  setInterval(loop, 15_000).unref();
  if (refresh) { const go = () => void refresh().catch(() => undefined); setTimeout(go, 60_000).unref(); setInterval(go, 3_600_000).unref(); }
}
