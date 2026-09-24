import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { resolveBinary } from './transcode.js';

// Record a live channel to a file you can watch later. The stream is copied,
// not re-encoded, so it costs almost no CPU. Nothing is scheduled: a
// recording starts when asked and stops after the chosen minutes or on demand.

export interface Recording {
  id: string;
  title: string;
  channel: string;
  startedAt: string;
  endsAt: string;
  state: 'recording' | 'done' | 'failed' | 'stopped';
  file: string;
  message?: string;
}

const DIR = process.env.RECORDINGS_DIR ? resolve(process.env.RECORDINGS_DIR) : resolve(DATA_DIR, 'recordings');
const INDEX = resolve(DIR, 'index.json');
const MAX_CONCURRENT = 3;
const active = new Map<string, ChildProcess>();

function load(): Recording[] {
  try { return existsSync(INDEX) ? (JSON.parse(readFileSync(INDEX, 'utf8')) as Recording[]) : []; } catch { return []; }
}
function save(list: Recording[]): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(INDEX, JSON.stringify(list), { encoding: 'utf8', mode: 0o600 });
}
function update(id: string, patch: Partial<Recording>): void {
  save(load().map(r => (r.id === id ? { ...r, ...patch } : r)));
}

// A restart mid-recording leaves a partial file: keep it, but say what happened.
save(load().map(r => (r.state === 'recording' && !active.has(r.id) ? { ...r, state: 'stopped' as const, message: 'The server restarted while this was recording.' } : r)));

export function listRecordings(): Array<Recording & { sizeBytes: number }> {
  return load().map(r => {
    let sizeBytes = 0;
    try { sizeBytes = statSync(resolve(DIR, r.file)).size; } catch { /* not written yet */ }
    return { ...r, sizeBytes };
  }).reverse();
}

export function recordingFile(id: string): string | null {
  const r = load().find(item => item.id === id);
  const file = r ? resolve(DIR, r.file) : '';
  return r && existsSync(file) ? file : null;
}

export function startRecording(url: string, channel: string, minutes: number): { ok: true; recording: Recording } | { ok: false; message: string } {
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) return { ok: false, message: 'Recording needs ffmpeg, which is not installed.' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, message: 'Only http and https streams can be recorded.' };
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) return { ok: false, message: 'Choose between 1 and 480 minutes.' };
  if (active.size >= MAX_CONCURRENT) return { ok: false, message: `${MAX_CONCURRENT} recordings are already running.` };
  const id = randomBytes(6).toString('hex');
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const safe = channel.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'channel';
  const file = `${safe}-${stamp}-${id.slice(0, 4)}.mp4`;
  mkdirSync(DIR, { recursive: true });
  const recording: Recording = {
    id, title: `${channel} ${now.toISOString().slice(0, 16).replace('T', ' ')}`, channel,
    startedAt: now.toISOString(), endsAt: new Date(now.getTime() + minutes * 60_000).toISOString(), state: 'recording', file
  };
  save([...load(), recording]);
  const child = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-fflags', '+genpts',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-i', url, '-t', String(minutes * 60), '-map', '0:v:0?', '-map', '0:a:0?',
    // Video is copied untouched; audio becomes AAC because live audio is often
    // a format MP4 cannot hold as-is, and it costs almost nothing.
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', resolve(DIR, file)
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  active.set(id, child);
  let err = '';
  child.stderr?.on('data', d => { err = (err + String(d)).slice(-300); });
  child.on('error', e => { active.delete(id); update(id, { state: 'failed', message: e.message }); });
  child.on('close', code => {
    const stopped = stops.delete(id);
    active.delete(id);
    const size = (() => { try { return statSync(resolve(DIR, file)).size; } catch { return 0; } })();
    if (size < 1024) update(id, { state: 'failed', message: err.trim() || 'The channel gave no data.' });
    else if (stopped || code === 0) update(id, { state: stopped ? 'stopped' : 'done' });
    else update(id, { state: 'failed', message: err.trim() || `ffmpeg exited ${code}` });
  });
  return { ok: true, recording };
}

const stops = new Set<string>();

export function stopRecording(id: string): boolean {
  const child = active.get(id);
  if (!child) return false;
  stops.add(id);
  child.kill('SIGINT');
  return true;
}

export function deleteRecording(id: string): boolean {
  const r = load().find(item => item.id === id);
  if (!r) return false;
  stopRecording(id);
  try { rmSync(resolve(DIR, r.file), { force: true }); } catch { /* already gone */ }
  save(load().filter(item => item.id !== id));
  return true;
}
