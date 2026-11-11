import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { acquireConversion, CONVERSION_MAX_MS } from '../lib/limits.js';
import { episodeAllowed, isAllowedMediaFile, resolveEpisodeFile, resolveStreamable } from '../routes/stream.js';
import { getAdapter } from './registry.js';
import type { LidarrAdapter } from '@virtuallyview/integrations';
import {
  extractSubtitleVtt, ffmpegFileArgs, pickAudioIndex, probeMedia, resolveBinary, vaapiDevice,
  type MediaProbe
} from './transcode.js';

/**
 * Downloads for offline use. A job converts one movie, episode or song into a finished file that plays
 * anywhere (H.264/AAC MP4, or M4A for music) and, for video, an English WebVTT subtitle file. Jobs belong
 * to the account that started them: a job id is random and only that account can see or fetch it.
 */

export type OfflineKind = 'movie' | 'episode' | 'track';
export type OfflineQuality = 'standard' | 'high';
export type OfflineStatus = 'queued' | 'preparing' | 'ready' | 'failed';

export interface OfflineJob {
  id: string;
  key: string;
  userId: string;
  kind: OfflineKind;
  mediaId: string;
  quality: OfflineQuality;
  audio?: number;
  status: OfflineStatus;
  percent: number;
  size?: number;
  hasSubtitles: boolean;
  message?: string;
  fileName: string;
  durationSeconds: number | null;
  startedAt: number;
  finishedAt?: number;
  fetchedAt?: number;
  release?: () => void;
}

/** One account may have this many jobs waiting or converting at once. */
export const MAX_ACTIVE_PER_USER = 3;
const DAY_MS = 24 * 3_600_000;
const WEEK_MS = 7 * DAY_MS;
const jobs = new Map<string, OfflineJob>();

export function offlineDir(): string {
  const dir = path.join(DATA_DIR, 'offline');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const fileFor = (key: string, kind: OfflineKind) => `${key}${kind === 'track' ? '.m4a' : '.mp4'}`;
const vttFor = (key: string) => `${key}.vtt`;

/** The ffmpeg `-progress` line gives microseconds (ffmpeg keeps the old out_time_ms name for them). */
const OUT_TIME_US = /out_time_(?:us|ms)=(-?\d+)/g;
const OUT_TIME = /out_time=(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/g;

/** Percent done for the last progress block in ffmpeg's `-progress pipe:1` output, or null if unknown. */
export function progressPercent(text: string, durationSeconds: number | null): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  let seconds: number | null = null;
  for (const m of text.matchAll(OUT_TIME_US)) seconds = Number(m[1]) / 1_000_000;
  if (seconds === null) {
    for (const m of text.matchAll(OUT_TIME)) {
      seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(`${m[3]}.${m[4] ?? '0'}`);
    }
  }
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return Math.max(0, Math.min(99, Math.floor((seconds / durationSeconds) * 100)));
}

/**
 * Removes jobs and files that are no longer needed: a finished job nobody fetched within a day, and any
 * file older than a week. Exported for tests (called with a fake "now"). Returns how many were removed.
 */
export function sweepOfflineFiles(now = Date.now()): number {
  let removed = 0;
  for (const job of [...jobs.values()]) {
    if (job.status === 'queued' || job.status === 'preparing') continue;
    const finishedAt = job.finishedAt ?? job.startedAt;
    const unfetched = job.fetchedAt === undefined && now - finishedAt > DAY_MS;
    if (unfetched || now - finishedAt > WEEK_MS) {
      removeJobFiles(job);
      jobs.delete(job.id);
      removed++;
    }
  }
  // Anything left in the folder that is a week old (for example from a job lost in a restart) goes too.
  const dir = offlineDir();
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    try {
      if (statSync(file).mtimeMs < now - WEEK_MS) { rmSync(file, { force: true }); removed++; }
    } catch { /* already gone */ }
  }
  return removed;
}

function removeJobFiles(job: OfflineJob): void {
  const dir = offlineDir();
  for (const name of [fileFor(job.key, job.kind), vttFor(job.key), `${job.key}.partial`, `${job.key}.vtt.partial`]) {
    try { rmSync(path.join(dir, name), { force: true }); } catch { /* best effort */ }
  }
}

setInterval(() => { sweepOfflineFiles(); }, 3_600_000).unref();

/** The on-disk input for one request, after the same permission checks the streaming routes use. */
export interface OfflineInput { path: string; probe: MediaProbe }
export type InputResult = { ok: true; input: OfflineInput } | { ok: false; status: number; message: string };

const NOT_AVAILABLE = 'This cannot be saved to a device. It may not be on the server, or it is above your age limit.';

export async function resolveOfflineInput(kind: OfflineKind, id: string): Promise<InputResult> {
  let filePath: string | null | undefined = null;
  if (kind === 'movie') {
    filePath = (await resolveStreamable(id))?.fileInfo?.path;
  } else if (kind === 'episode') {
    if (!(await episodeAllowed(id))) return { ok: false, status: 404, message: NOT_AVAILABLE };
    filePath = await resolveEpisodeFile(id);
  } else {
    const numeric = id.replace(/^track-/, '');
    if (!/^\d+$/.test(numeric)) return { ok: false, status: 400, message: 'Invalid track id.' };
    try {
      filePath = (await getAdapter<LidarrAdapter>('lidarr').getTrackFile(numeric))?.path;
    } catch {
      return { ok: false, status: 503, message: 'Music is not available right now. Try again later.' };
    }
  }
  if (!filePath || !existsSync(filePath) || !isAllowedMediaFile(filePath)) {
    return { ok: false, status: 404, message: NOT_AVAILABLE };
  }
  return { ok: true, input: { path: filePath, probe: await probeMedia(filePath) } };
}

const keyFor = (userId: string, kind: OfflineKind, mediaId: string, quality: OfflineQuality, audio?: number) =>
  createHash('sha256').update([userId, kind, mediaId, quality, audio ?? 'default'].join('|')).digest('hex').slice(0, 32);

const isActive = (job: OfflineJob) => job.status === 'queued' || job.status === 'preparing';

export interface PrepareRequest { kind: OfflineKind; id: string; quality?: OfflineQuality; audio?: number }
export type PrepareResult = { ok: true; job: OfflineJob } | { ok: false; status: number; message: string };

/**
 * Starts a download for this account, or returns the one it already has for the same item. A finished
 * file left on disk (from before a restart) is adopted rather than converted again.
 */
export async function prepareOfflineJob(userId: string, request: PrepareRequest): Promise<PrepareResult> {
  if (!resolveBinary('ffmpeg')) return { ok: false, status: 503, message: 'Saving for offline needs ffmpeg on the server.' };
  const quality: OfflineQuality = request.quality === 'high' ? 'high' : 'standard';
  const audio = Number.isInteger(request.audio) && (request.audio ?? -1) >= 0 ? request.audio : undefined;
  const found = await resolveOfflineInput(request.kind, request.id);
  if (!found.ok) return found;

  const key = keyFor(userId, request.kind, request.id, quality, audio);
  const fileName = fileFor(key, request.kind);
  const existing = [...jobs.values()].find(j => j.userId === userId && j.key === key && j.status !== 'failed');
  if (existing) return { ok: true, job: existing };

  const base = { userId, key, kind: request.kind, mediaId: request.id, quality, audio, percent: 0, fileName, durationSeconds: found.input.probe.durationSeconds ?? null };
  const onDisk = path.join(offlineDir(), fileName);
  if (existsSync(onDisk)) {
    const job: OfflineJob = { ...base, id: randomBytes(16).toString('hex'), status: 'ready', percent: 100, size: statSync(onDisk).size,
      hasSubtitles: existsSync(path.join(offlineDir(), vttFor(key))), startedAt: Date.now(), finishedAt: statSync(onDisk).mtimeMs };
    jobs.set(job.id, job);
    return { ok: true, job };
  }

  const active = [...jobs.values()].filter(j => j.userId === userId && isActive(j)).length;
  if (active >= MAX_ACTIVE_PER_USER) {
    return { ok: false, status: 429, message: `You already have ${MAX_ACTIVE_PER_USER} downloads being prepared. Wait for one to finish, then try again.` };
  }

  const job: OfflineJob = { ...base, id: randomBytes(16).toString('hex'), status: 'queued', hasSubtitles: false, startedAt: Date.now() };
  jobs.set(job.id, job);
  void runJob(job, found.input);
  return { ok: true, job };
}

/** The job only if this account started it. Anyone else gets nothing, not even "forbidden". */
export function getOfflineJob(userId: string, jobId: string): OfflineJob | null {
  const job = jobs.get(jobId);
  return job && job.userId === userId ? job : null;
}

/** The job's file path, when it is ready and still on disk. */
export function readyFilePath(job: OfflineJob): string | null {
  if (job.status !== 'ready') return null;
  const file = path.join(offlineDir(), job.fileName);
  return existsSync(file) ? file : null;
}

export function readyVttPath(job: OfflineJob): string | null {
  if (!job.hasSubtitles) return null;
  const file = path.join(offlineDir(), vttFor(job.key));
  return existsSync(file) ? file : null;
}

export function markFetched(job: OfflineJob): void {
  job.fetchedAt = Date.now();
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref(); });
}

/** Subtitle the browser can show: English text subtitles, embedded first, then a sidecar file next to the video. */
async function englishSubtitle(input: OfflineInput, outVtt: string): Promise<boolean> {
  const embedded = (input.probe.subtitleStreams ?? []).find(s => s.text && /^(eng|en)$/i.test(s.language));
  if (embedded) {
    const vtt = await extractSubtitleVtt(input.path, embedded.index);
    if (vtt) { writeFileSync(outVtt, vtt); return true; }
  }
  const dir = path.dirname(input.path);
  const base = path.basename(input.path, path.extname(input.path)).toLowerCase();
  const sidecar = readdirSync(dir).find(entry => {
    const lower = entry.toLowerCase();
    if (!lower.startsWith(base) || !['.srt', '.vtt', '.ass', '.ssa'].includes(path.extname(lower))) return false;
    return /\.(en|eng|english)(\.|$)/.test(lower.slice(base.length));
  });
  if (!sidecar) return false;
  const source = path.join(dir, sidecar);
  if (!isAllowedMediaFile(source)) return false;
  if (path.extname(sidecar).toLowerCase() === '.vtt') {
    writeFileSync(outVtt, readFileSync(source, 'utf8'));
    return true;
  }
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) return false;
  return new Promise<boolean>(resolve => {
    let out = '';
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source, '-f', 'webvtt', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout?.on('data', chunk => { out += chunk.toString(); });
    child.on('error', () => resolve(false));
    child.on('close', code => {
      if (code === 0 && out.includes('WEBVTT')) { writeFileSync(outVtt, out); resolve(true); } else resolve(false);
    });
  });
}

function finish(job: OfflineJob, ok: boolean, message?: string): void {
  job.release?.();
  job.release = undefined;
  if (ok) {
    job.status = 'ready';
    job.percent = 100;
    job.finishedAt = Date.now();
  } else {
    job.status = 'failed';
    job.message = message ?? 'The download could not be prepared.';
    removeJobFiles(job);
  }
}

/** Converts the input, waiting for a free conversion slot first. Runs in the background. */
async function runJob(job: OfflineJob, input: OfflineInput): Promise<void> {
  let release = acquireConversion(job.userId);
  while (!release) {
    await wait(2_000);
    if (!jobs.has(job.id)) return;
    release = acquireConversion(job.userId);
  }
  job.release = release;
  job.status = 'preparing';
  const dir = offlineDir();
  const partial = path.join(dir, `${job.key}.partial`);
  const isTrack = job.kind === 'track';
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) return finish(job, false, 'ffmpeg is not installed on the server.');
  try {
    if (!isTrack) {
      const vtt = path.join(dir, `${job.key}.vtt.partial`);
      try {
        if (await englishSubtitle(input, vtt)) {
          renameSync(vtt, path.join(dir, vttFor(job.key)));
          job.hasSubtitles = true;
        }
      } catch { /* subtitles are optional */ }
      rmSync(vtt, { force: true });
    }
    const audioIndex = pickAudioIndex(input.probe.audioTracks ?? [], job.audio);
    const args = isTrack
      ? ffmpegFileArgs(input.path, partial, { kind: 'audio', audioCodec: input.probe.audioCodec })
      : ffmpegFileArgs(input.path, partial, { kind: 'video', quality: job.quality, audio: audioIndex, sourceHeight: input.probe.height ?? null, vaapi: vaapiDevice(), hdr: input.probe.hdr, hdrMastering: input.probe.hdrMastering });
    const child: ChildProcess = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const limit = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } }, CONVERSION_MAX_MS);
    limit.unref();
    let progress = '';
    child.stdout?.on('data', chunk => {
      progress = (progress + chunk.toString()).slice(-4096);
      const percent = progressPercent(progress, job.durationSeconds);
      if (percent !== null && percent > job.percent) job.percent = percent;
    });
    child.stderr?.on('data', () => { /* diagnostics are not shown to the viewer */ });
    child.on('error', () => { clearTimeout(limit); finish(job, false, 'ffmpeg could not start.'); });
    child.on('close', code => {
      clearTimeout(limit);
      if (job.status !== 'preparing') return;
      if (code === 0 && existsSync(partial)) {
        renameSync(partial, path.join(dir, job.fileName));
        job.size = statSync(path.join(dir, job.fileName)).size;
        finish(job, true);
      } else {
        rmSync(partial, { force: true });
        finish(job, false, 'This file could not be converted. Try another quality or item.');
      }
    });
  } catch {
    finish(job, false, 'This file could not be converted.');
  }
}

/** For the route: what the browser sees about a job. */
export function jobView(job: OfflineJob) {
  return {
    jobId: job.id,
    status: job.status,
    percent: job.percent,
    ...(job.size !== undefined ? { size: job.size } : {}),
    hasSubtitles: job.hasSubtitles,
    ...(job.message ? { message: job.message } : {})
  };
}

/** Test helper: forget every job (files are not touched). */
export function resetOfflineJobsForTests(): void {
  jobs.clear();
}
