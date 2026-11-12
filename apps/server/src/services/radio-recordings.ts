import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Opener } from './radio-timeshift.js';
import { recordingsDir } from './recordings.js';
import { freeBytesAt } from './storage-planner.js';
import { resolveBinary } from './transcode.js';

// Record a radio show to an audio file, the same way Live TV records (services/recordings.ts): ffmpeg writes a
// fragmented .m4a (playable even if the server stops mid-way) for the chosen minutes or until stopped. Each
// recording belongs to the person who started it; nobody else sees, stops, downloads or deletes it.

export interface RadioRecording {
  id: string;
  owner: string;
  stationId: string;
  station: string;
  title: string;
  startedAt: string;
  endsAt: string;
  state: 'recording' | 'done' | 'failed' | 'stopped';
  file: string;
  message?: string;
}

const DIR = resolve(recordingsDir(), 'radio');
const INDEX = resolve(DIR, 'index.json');
export const RECORD_LIMITS = { total: 3, perPerson: 2, maxMinutes: 240, minFree: 1024 * 1024 * 1024 };
const active = new Map<string, { child: ChildProcess; abort: AbortController }>();
const stops = new Set<string>();

function load(): RadioRecording[] {
  try { return existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, 'utf8')) as RadioRecording[]) : []; } catch { return []; }
}
function save(list: RadioRecording[]): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(INDEX, JSON.stringify(list), { encoding: 'utf8', mode: 0o600 });
}
const update = (id: string, patch: Partial<RadioRecording>) => save(load().map(r => (r.id === id ? { ...r, ...patch } : r)));
const sizeOf = (file: string) => { try { return statSync(resolve(DIR, file)).size; } catch { return 0; } };

// A restart mid-recording leaves a partial (still playable) file: keep it, but say what happened.
if (load().some(r => r.state === 'recording')) save(load().map(r => (r.state === 'recording' ? { ...r, state: 'stopped' as const, message: 'The server restarted while this was recording.' } : r)));

export const listRadioRecordings = (owner: string): Array<RadioRecording & { sizeBytes: number }> =>
  load().filter(r => r.owner === owner).map(r => ({ ...r, sizeBytes: sizeOf(r.file) })).reverse();

export function radioRecordingFile(owner: string, id: string): string | null {
  const r = load().find(x => x.id === id && x.owner === owner);
  const file = r ? resolve(DIR, r.file) : '';
  return r && existsSync(file) ? file : null;
}

export async function startRadioRecording(owner: string, station: { id: string; name: string }, minutes: number, open: Opener): Promise<{ ok: true; recording: RadioRecording } | { ok: false; status: number; message: string }> {
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) return { ok: false, status: 503, message: 'Recording needs ffmpeg, which is not installed.' };
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > RECORD_LIMITS.maxMinutes) return { ok: false, status: 400, message: `Choose between 1 and ${RECORD_LIMITS.maxMinutes} minutes.` };
  const mine = load().filter(r => r.owner === owner && active.has(r.id)).length;
  if (mine >= RECORD_LIMITS.perPerson) return { ok: false, status: 429, message: `You are already recording ${mine} shows. Stop one first.` };
  if (active.size >= RECORD_LIMITS.total) return { ok: false, status: 429, message: `${RECORD_LIMITS.total} radio recordings are already running on this server.` };
  mkdirSync(DIR, { recursive: true });
  const free = await freeBytesAt(DIR);
  if (free !== null && free < RECORD_LIMITS.minFree) return { ok: false, status: 507, message: 'The server is low on disk space, so it cannot record now.' };
  const abort = new AbortController();
  let source;
  try { source = await open(abort.signal); } catch (e) { return { ok: false, status: 502, message: e instanceof Error ? e.message : 'The station could not be reached.' }; }

  const id = randomBytes(6).toString('hex');
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const safe = station.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'radio';
  const file = `${safe}-${stamp}-${id.slice(0, 4)}.m4a`;
  const recording: RadioRecording = {
    id, owner, stationId: station.id, station: station.name, title: `${station.name} ${now.toISOString().slice(0, 16).replace('T', ' ')}`,
    startedAt: now.toISOString(), endsAt: new Date(now.getTime() + minutes * 60_000).toISOString(), state: 'recording', file
  };
  save([...load(), recording]);
  const child = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-fflags', '+genpts', '-i', 'pipe:0', '-t', String(minutes * 60), '-vn', '-map', '0:a:0',
    '-c:a', 'aac', '-b:a', '128k', '-f', 'mp4', '-movflags', '+empty_moov+default_base_moof', '-frag_duration', '5000000', resolve(DIR, file)
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  active.set(id, { child, abort });
  // A station that stalls would keep ffmpeg waiting past the end: stop it a little after.
  const limit = setTimeout(() => stopRadioRecording(owner, id), minutes * 60_000 + 30_000);
  limit.unref();
  let err = '';
  child.stderr?.on('data', d => { err = (err + String(d)).slice(-300); });
  child.stdin?.on('error', () => undefined);
  void (async () => {
    try { for await (const chunk of source.chunks) { if (abort.signal.aborted || !child.stdin?.writable) break; if (!child.stdin.write(chunk)) await once(child.stdin, 'drain', { signal: abort.signal }); } } catch { /* stopped */ }
    child.stdin?.end();
  })();
  child.on('error', e => { active.delete(id); abort.abort(); update(id, { state: 'failed', message: e.message }); });
  child.on('close', code => {
    clearTimeout(limit);
    abort.abort();
    const stopped = stops.delete(id);
    active.delete(id);
    if (sizeOf(file) < 1024) update(id, { state: 'failed', message: err.trim() || 'The station sent no audio.' });
    else if (stopped || code === 0) update(id, { state: stopped ? 'stopped' : 'done' });
    else update(id, { state: 'failed', message: err.trim() || `ffmpeg exited ${code}` });
  });
  return { ok: true, recording };
}

export function stopRadioRecording(owner: string, id: string): boolean {
  const run = active.get(id);
  if (!run || !load().some(r => r.id === id && r.owner === owner)) return false;
  stops.add(id);
  // Ending the input lets ffmpeg finish the file cleanly, like Ctrl+C.
  run.abort.abort();
  run.child.kill('SIGINT');
  return true;
}

export function deleteRadioRecording(owner: string, id: string): boolean {
  const r = load().find(x => x.id === id && x.owner === owner);
  if (!r) return false;
  stopRadioRecording(owner, id);
  try { rmSync(resolve(DIR, r.file), { force: true }); } catch { /* already gone */ }
  save(load().filter(x => x.id !== id));
  return true;
}

export const activeRadioRecordings = (): number[] => [...active.values()].flatMap(a => (a.child.pid ? [a.child.pid] : []));
