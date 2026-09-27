import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireConversion, CONVERSION_MAX_MS } from '../lib/limits.js';
import { ffmpegHlsArgs, resolveBinary, HLS_PLAYLIST, HLS_SEGMENT_PATTERN, type TranscodeOptions } from './transcode.js';

/**
 * One ffmpeg process per "watch this file from this position with these options", writing HLS segments
 * to its own temp folder, so a player that only understands HLS (Safari, and the TV and embedded browsers
 * built on the same engine) can play a live conversion at all. Sessions are looked up by a key the route
 * builds from the file identity and playback options, so re-requesting the same combination (a page
 * reload, a second tab) reuses the ffmpeg already running instead of starting another.
 */

interface Session { dir: string; process: ChildProcess; release: () => void; lastAccess: number; ended: boolean }

const sessions = new Map<string, Session>();
const IDLE_MS = 25_000;
export const HLS_SEGMENT_RE = /^seg\d{5}\.ts$/;

function cleanup(key: string): void {
  const s = sessions.get(key);
  if (!s) return;
  sessions.delete(key);
  s.ended = true;
  try { s.process.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(s.dir, { recursive: true, force: true }); } catch { /* best effort */ }
  s.release();
}

// A session nobody has asked for in a while (the tab was closed, or the player moved on) is torn down;
// nothing here ever grows without bound.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions) if (now - s.lastAccess > IDLE_MS) cleanup(key);
}, 5_000);
sweep.unref();

export type HlsStart = { ok: true; dir: string } | { ok: false; status: number; message: string };

/** Starts the session's ffmpeg if it is not already running, and returns where its files land. */
export function ensureHlsSession(key: string, userId: string, filePath: string, startSeconds: number, options: TranscodeOptions): HlsStart {
  const existing = sessions.get(key);
  if (existing && !existing.ended) { existing.lastAccess = Date.now(); return { ok: true, dir: existing.dir }; }

  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) return { ok: false, status: 503, message: 'This file needs conversion, but ffmpeg is not installed on the server.' };
  const release = acquireConversion(userId);
  if (!release) return { ok: false, status: 429, message: 'Too many videos are being converted right now. Close another player or try again in a moment.' };

  const dir = mkdtempSync(join(tmpdir(), 'vv-hls-'));
  let child: ChildProcess;
  try {
    child = spawn(ffmpeg, ffmpegHlsArgs(filePath, startSeconds, options), { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    release();
    return { ok: false, status: 503, message: err instanceof Error ? err.message : 'The converter could not start.' };
  }
  child.stderr?.on('data', () => undefined); // diagnostics only; never blocks the encoder
  // ffmpeg exiting (end of file, or a fatal error) is not itself a reason to delete the segments right
  // away: the player may still be reading the tail of a finished, fully-written playlist. The idle sweep
  // above reclaims it once nobody has asked for it in a while.
  child.on('error', () => cleanup(key));
  const timer = setTimeout(() => cleanup(key), CONVERSION_MAX_MS);
  timer.unref();
  sessions.set(key, { dir, process: child, release, lastAccess: Date.now(), ended: false });
  return { ok: true, dir };
}

/** The session's folder, if it is still open, and marks it as recently used. */
export function touchHlsSession(key: string): string | null {
  const s = sessions.get(key);
  if (!s) return null;
  s.lastAccess = Date.now();
  return s.dir;
}

export function playlistPath(dir: string): string { return join(dir, HLS_PLAYLIST); }
export function segmentPath(dir: string, segment: string): string { return join(dir, segment); }

export { HLS_SEGMENT_PATTERN };
