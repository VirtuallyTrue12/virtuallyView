import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import type { RadioSource } from './radio.js';
import { freeBytesAt } from './storage-planner.js';
import { resolveBinary } from './transcode.js';

/**
 * Pause and rewind live radio. While someone listens, the station's audio is fed into ffmpeg, which keeps the last
 * 30 minutes as HLS segments in DATA_DIR/radio-buffer/<station>. The page plays that playlist with hls.js, so it can
 * pause and seek back inside the window. One buffer per station, shared by everyone listening to it.
 *
 * Limits: a few buffers at once, a size cap per buffer, and a buffer nobody has asked for in 5 minutes is stopped and
 * deleted. ffmpeg only reads from this process (stdin), so it also ends when the server does: no orphans.
 */

export const LIMITS = {
  /** Stations buffered at once, for everyone together. */
  buffers: Number(process.env.RADIO_TIMESHIFT_MAX) || 4,
  /** Stations one person may hold open at once (same as the plain stream). */
  perPerson: 3,
  /** Stopped and deleted when nobody has asked for it this long. */
  idleMs: 5 * 60_000,
  /** One buffer's disk use: 30 minutes even at 320 kbps is about 72 MB. */
  bytes: 100 * 1024 * 1024,
  /** Free disk left for everything else; no new buffer below it. */
  minFree: 512 * 1024 * 1024,
  /** How long to wait for the first segment. */
  startMs: 20_000
};
export const SEGMENT_SECONDS = 4;
export const WINDOW_SECONDS = 30 * 60;
const DIR = resolve(DATA_DIR, 'radio-buffer');
const PLAYLIST = 'index.m3u8';
const SEGMENT = /^seg\d{5}\.ts$/;

export type Opener = (signal: AbortSignal) => Promise<RadioSource>;
interface Buffer { dir: string; child: ChildProcess; abort: AbortController; seen: Map<string, number>; lastAt: number; ready: Promise<boolean> }
const buffers = new Map<string, Buffer>();

// Anything left by a previous run is stale.
try { rmSync(DIR, { recursive: true, force: true }); } catch { /* not there */ }
process.on('exit', () => { for (const b of buffers.values()) try { b.child.kill('SIGKILL'); } catch { /* gone */ } });

/** MP3 and AAC go into the segments as they are; anything else (Ogg, Opus, FLAC) becomes AAC. */
export const copies = (type: string): boolean => type === 'hls' || /audio\/(mpeg|mp3|aac|aacp|x-aac)/i.test(type);

export function ffmpegArgs(type: string, dir: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-fflags', '+genpts', '-i', 'pipe:0', '-vn', '-map', '0:a:0',
    ...(copies(type) ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k']),
    '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_list_size', String(WINDOW_SECONDS / SEGMENT_SECONDS),
    '-hls_flags', 'delete_segments+program_date_time+omit_endlist+temp_file',
    '-hls_segment_filename', resolve(dir, 'seg%05d.ts'), resolve(dir, PLAYLIST)
  ];
}

const sizeOf = (dir: string) => { try { return readdirSync(dir).reduce((n, f) => n + statSync(resolve(dir, f)).size, 0); } catch { return 0; } };
const hasSegment = (dir: string) => { try { return /\.ts\s*$/m.test(readFileSync(resolve(dir, PLAYLIST), 'utf8')); } catch { return false; } };

export function stopBuffer(id: string): void {
  const b = buffers.get(id);
  if (!b) return;
  buffers.delete(id);
  b.abort.abort();
  try { b.child.kill('SIGTERM'); } catch { /* gone */ }
  const force = setTimeout(() => { try { b.child.kill('SIGKILL'); } catch { /* gone */ } }, 3000);
  force.unref();
  const clear = () => { clearTimeout(force); try { rmSync(b.dir, { recursive: true, force: true }); } catch { /* gone */ } };
  if (b.child.exitCode !== null || b.child.signalCode !== null) clear(); else b.child.once('close', clear);
}

/** Stops buffers nobody asked for in a while, or that grew past their size cap. */
export function sweep(now = Date.now()): void {
  for (const [id, b] of buffers) if (now - b.lastAt > LIMITS.idleMs || sizeOf(b.dir) > LIMITS.bytes) stopBuffer(id);
}
let sweeper: NodeJS.Timeout | null = null;

const listening = (b: Buffer, who: string, now: number) => now - (b.seen.get(who) ?? 0) < 60_000;

/**
 * Makes sure `id` is being buffered for `who` and its first segment exists. Starts ffmpeg when nobody else is on
 * this station. Errors carry the HTTP status the route should answer with.
 */
export async function ensureBuffer(id: string, who: string, open: Opener): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const now = Date.now();
  let b = buffers.get(id);
  if (!b) {
    if ([...buffers.values()].filter(x => listening(x, who, now)).length >= LIMITS.perPerson) return { ok: false, status: 429, message: 'Too many stations are playing at once. Close one first.' };
    if (buffers.size >= LIMITS.buffers) {
      // Full: make room by stopping the one left alone longest, if nobody has touched it for a minute.
      const [oldId, oldest] = [...buffers].sort((x, y) => x[1].lastAt - y[1].lastAt)[0]!;
      if (now - oldest.lastAt < 60_000) return { ok: false, status: 503, message: 'Pause and rewind is busy for everyone right now. The station plays live instead.' };
      stopBuffer(oldId);
    }
    const ffmpeg = resolveBinary('ffmpeg');
    if (!ffmpeg) return { ok: false, status: 503, message: 'Pause and rewind needs ffmpeg, which is not installed.' };
    mkdirSync(DIR, { recursive: true });
    const free = await freeBytesAt(DIR);
    if (free !== null && free < LIMITS.minFree) return { ok: false, status: 507, message: 'The server is low on disk space, so the station plays live only.' };
    const abort = new AbortController();
    let source: RadioSource;
    try { source = await open(abort.signal); } catch (e) { return { ok: false, status: 502, message: e instanceof Error ? e.message : 'The station could not be reached.' }; }
    // Another request may have started it while this one waited for the station.
    const raced = buffers.get(id);
    if (raced) { abort.abort(); b = raced; } else {
      const dir = resolve(DIR, id);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const child = spawn(ffmpeg, ffmpegArgs(source.type, dir), { stdio: ['pipe', 'ignore', 'pipe'] });
      child.stderr?.on('data', () => undefined);
      child.stdin?.on('error', () => undefined);
      const fresh: Buffer = { dir, child, abort, seen: new Map(), lastAt: now, ready: Promise.resolve(false) };
      child.on('close', () => { if (buffers.get(id) === fresh) stopBuffer(id); else abort.abort(); });
      void (async () => {
        try { for await (const chunk of source.chunks) { if (abort.signal.aborted || !child.stdin?.writable) break; if (!child.stdin.write(chunk)) await once(child.stdin, 'drain', { signal: abort.signal }); } } catch { /* stopped or ffmpeg gone */ }
        child.stdin?.end();
      })();
      fresh.ready = (async () => {
        for (const until = Date.now() + LIMITS.startMs; Date.now() < until;) {
          if (hasSegment(dir)) return true;
          if (child.exitCode !== null || abort.signal.aborted) return false;
          await new Promise(r => setTimeout(r, 300));
        }
        return false;
      })();
      buffers.set(id, fresh);
      b = fresh;
      sweeper ??= setInterval(() => sweep(), 30_000).unref();
    }
  }
  b.seen.set(who, now);
  b.lastAt = now;
  if (b.seen.size > 200) b.seen.delete(b.seen.keys().next().value!);
  if (await b.ready) return { ok: true };
  if (buffers.get(id) === b) stopBuffer(id);
  return { ok: false, status: 502, message: 'The station sent no audio. It may be off the air.' };
}

/** The playlist, or null when that station is not being buffered. Reading it counts as listening. */
export function readPlaylist(id: string, who: string): string | null {
  const b = buffers.get(id);
  if (!b) return null;
  b.lastAt = Date.now(); b.seen.set(who, b.lastAt);
  try { return readFileSync(resolve(b.dir, PLAYLIST), 'utf8'); } catch { return null; }
}

/** The file of one segment of a buffered station, or null. */
export function segmentFile(id: string, name: string): string | null {
  const b = buffers.get(id);
  if (!b || !SEGMENT.test(name)) return null;
  b.lastAt = Date.now();
  const file = resolve(b.dir, name);
  return existsSync(file) ? file : null;
}

/** What is buffered now, for tests and the diagnostics. */
export const activeBuffers = (): Array<{ id: string; pid: number | undefined; bytes: number; idleMs: number }> =>
  [...buffers].map(([id, b]) => ({ id, pid: b.child.pid, bytes: sizeOf(b.dir), idleMs: Date.now() - b.lastAt }));
