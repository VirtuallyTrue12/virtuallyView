import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import type { SonarrAdapter } from '@virtuallyview/integrations';
import { get, run } from '../db/app-db.js';
import { getAdapter } from './registry.js';
import { probeMedia, resolveBinary } from './transcode.js';
import { LOW_PRIORITY } from './trickplay.js';

// Skip intro / skip credits. The intro is the stretch of sound that episodes of one season share near their
// start (the theme tune), found by comparing simple audio fingerprints. Credits are a long run of black (or
// text over black) that lasts to the end of the file. Both are found by a background job, one file at a time
// at low priority, and cached per file; playback only ever reads the cache.

export interface Segments { intro?: { start: number; end: number }; credits?: { start: number } }

// ---------------------------------------------------------------- fingerprints

const RATE = 8000;
const WINDOW = 2048;
/** One fingerprint frame every 0.1 s. */
export const FRAME_SECONDS = 0.1;
const HOP = RATE * FRAME_SECONDS;
const BANDS = 33;
/** How much of each episode is compared: intros sit in the first ten minutes. */
const INTRO_SCAN_SECONDS = 600;

/** In-place radix-2 FFT (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti;
        re[a] = re[a]! + tr; im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/**
 * A 32-bit code per 0.1 s of 8 kHz mono sound: whether the energy difference between neighbouring
 * frequency bands (300-2000 Hz) rose or fell since the last frame. Loudness changes do not alter it.
 * Quiet frames are -1 so stretches of silence never count as a match.
 */
export function fingerprint(pcm: Int16Array): number[] {
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.round((300 * Math.pow(2000 / 300, i / BANDS) * WINDOW) / RATE));
  const hann = Float64Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW));
  const out: number[] = [];
  let prev: Float64Array | null = null;
  for (let start = 0; start + WINDOW <= pcm.length; start += HOP) {
    const re = new Float64Array(WINDOW), im = new Float64Array(WINDOW);
    let power = 0;
    for (let i = 0; i < WINDOW; i++) { const s = pcm[start + i]! / 32768; power += s * s; re[i] = s * hann[i]!; }
    fft(re, im);
    const bands = new Float64Array(BANDS);
    for (let b = 0; b < BANDS; b++) for (let k = edges[b]!; k < edges[b + 1]!; k++) bands[b]! += re[k]! * re[k]! + im[k]! * im[k]!;
    if (prev && Math.sqrt(power / WINDOW) > 0.003) {
      let code = 0;
      for (let b = 0; b < BANDS - 1; b++) if (bands[b]! - bands[b + 1]! - (prev[b]! - prev[b + 1]!) > 0) code |= 1 << b;
      out.push(code >>> 0);
    } else out.push(-1);
    prev = bands;
  }
  return out;
}

const popcount = (x: number) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };

/** Frames match when at most this many of the 32 bits differ (unrelated sound averages 16). */
const MATCH_BITS = 10;
/** A run survives a one-second patch that does not match (a sound effect over the theme, say). */
const MAX_GAP = 10;
const MIN_RUN = 10 / FRAME_SECONDS;
const MAX_RUN = 180 / FRAME_SECONDS;

export interface SharedRun { aStart: number; aEnd: number; bStart: number; bEnd: number }

/**
 * The longest stretch (10 s to 3 min) of two fingerprints that sounds the same, at any offset between them.
 * Returns frame indexes (end exclusive), or null when nothing that long is shared.
 */
export function longestSharedRun(a: number[], b: number[]): SharedRun | null {
  let best: SharedRun | null = null;
  for (let shift = -(b.length - 1); shift < a.length; shift++) {
    const from = Math.max(0, shift), to = Math.min(a.length, b.length + shift);
    let runStart = -1, last = -1, hits = 0;
    const close = () => {
      const len = last + 1 - runStart;
      // Mostly matching frames: a chain of chance matches is far sparser than this.
      if (runStart >= 0 && len >= MIN_RUN && len <= MAX_RUN && hits / len >= 0.5 && (!best || len > best.aEnd - best.aStart)) {
        best = { aStart: runStart, aEnd: last + 1, bStart: runStart - shift, bEnd: last + 1 - shift };
      }
    };
    for (let i = from; i < to; i++) {
      const x = a[i]!, y = b[i - shift]!;
      if (x < 0 || y < 0 || popcount((x ^ y) >>> 0) > MATCH_BITS) continue;
      if (runStart < 0 || i - last > MAX_GAP) { close(); runStart = i; hits = 0; }
      last = i; hits++;
    }
    close();
  }
  return best;
}

/**
 * Intro for each episode of one season, in the same order: the longest run it shares with the episode
 * before or after it. Episodes that share nothing get none.
 */
export function seasonIntros(prints: number[][]): Array<{ start: number; end: number } | null> {
  return prints.map((print, i) => {
    let best: { start: number; end: number } | null = null;
    for (const j of [i - 1, i + 1]) {
      const other = prints[j];
      if (!other) continue;
      const run = longestSharedRun(print, other);
      if (run && (!best || run.aEnd - run.aStart > (best.end - best.start) / FRAME_SECONDS)) {
        best = { start: round1(run.aStart * FRAME_SECONDS), end: round1(run.aEnd * FRAME_SECONDS) };
      }
    }
    // A theme that starts the file is skipped from the very start.
    if (best && best.start < 2) best.start = 0;
    return best;
  });
}

// ---------------------------------------------------------------- credits

const CREDITS_CHAPTER = /^(credits|end credits|ending|outro|ed)\b/i;
/** The share of the file, at its end, searched for credits. */
const CREDITS_SCAN_SHARE = 0.1;

/**
 * Credits start from black stretches (seconds, in file time) found near the end. Only a run of black that
 * lasts at least 20 s and reaches the last 5 s counts: no button is better than a wrong one.
 */
export function creditsFromBlack(intervals: Array<{ start: number; end: number }>, duration: number): number | null {
  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of [...intervals].sort((x, y) => x.start - y.start)) {
    const tail = merged.at(-1);
    if (tail && iv.start - tail.end <= 2) tail.end = Math.max(tail.end, iv.end);
    else merged.push({ ...iv });
  }
  const last = merged.at(-1);
  if (!last || last.end < duration - 5 || last.end - last.start < 20) return null;
  return round1(last.start);
}

/** Reads blackdetect's report lines. */
export function parseBlackdetect(stderr: string, offset: number): Array<{ start: number; end: number }> {
  return [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map(m => ({ start: offset + Number(m[1]), end: offset + Number(m[2]) }));
}

// ---------------------------------------------------------------- the cache

type Row = { file_size: number; file_mtime: number; intro_checked: number; intro_start: number | null; intro_end: number | null; credits_checked: number; credits_start: number | null };

function fileStamp(filePath: string): { size: number; mtime: number } | null {
  try { const s = statSync(filePath); return { size: s.size, mtime: s.mtimeMs }; } catch { return null; }
}

/** The cached row, only while the file on disk is still the one it describes. */
function rowFor(filePath: string): Row | null {
  const stamp = fileStamp(filePath);
  const row = get<Row>('SELECT * FROM media_segments WHERE file_path = ?', filePath);
  return stamp && row && row.file_size === stamp.size && row.file_mtime === stamp.mtime ? row : null;
}

function save(filePath: string, part: { intro: { start: number; end: number } | null } | { credits: number | null }): void {
  const stamp = fileStamp(filePath);
  if (!stamp) return;
  if (!rowFor(filePath)) {
    run(`INSERT INTO media_segments (file_path, file_size, file_mtime) VALUES (?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET file_size = excluded.file_size, file_mtime = excluded.file_mtime,
      intro_checked = 0, intro_start = NULL, intro_end = NULL, credits_checked = 0, credits_start = NULL`, filePath, stamp.size, stamp.mtime);
  }
  if ('intro' in part) run('UPDATE media_segments SET intro_checked = 1, intro_start = ?, intro_end = ? WHERE file_path = ?', part.intro?.start ?? null, part.intro?.end ?? null, filePath);
  else run('UPDATE media_segments SET credits_checked = 1, credits_start = ? WHERE file_path = ?', part.credits, filePath);
}

/** What the player can offer for this file right now (nothing until the detector has run). */
export function segmentsFor(filePath: string): Segments {
  const row = rowFor(filePath);
  if (!row) return {};
  return {
    ...(row.intro_start !== null && row.intro_end !== null ? { intro: { start: row.intro_start, end: row.intro_end } } : {}),
    ...(row.credits_start !== null ? { credits: { start: row.credits_start } } : {})
  };
}

// ---------------------------------------------------------------- the background job

/** No single ffmpeg run may take longer than this. */
const RUN_CAP_MS = 5 * 60_000;

function ffmpeg(args: string[], wantStdout: boolean): Promise<{ stdout: Buffer; stderr: string }> {
  const bin = resolveBinary('ffmpeg');
  if (!bin) return Promise.reject(new Error('no ffmpeg'));
  return new Promise((ok, fail) => {
    const child = spawn(LOW_PRIORITY[0]!, [...LOW_PRIORITY.slice(1), bin, '-hide_banner', '-nostdin', ...args], { stdio: ['ignore', wantStdout ? 'pipe' : 'ignore', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => chunks.push(d));
    child.stderr?.on('data', d => { stderr = (stderr + String(d)).slice(-200_000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_CAP_MS);
    child.on('error', err => { clearTimeout(timer); fail(err); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) ok({ stdout: Buffer.concat(chunks), stderr }); else fail(new Error(stderr.slice(-200) || `ffmpeg exited ${code}`)); });
  });
}

/** Fingerprint of the first ten minutes of a file's first audio track. */
export async function fingerprintFile(filePath: string): Promise<number[]> {
  const { stdout } = await ffmpeg(['-loglevel', 'error', '-t', String(INTRO_SCAN_SECONDS), '-i', filePath, '-map', '0:a:0', '-vn', '-sn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], true);
  return fingerprint(new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2)));
}

/** Credits start for one file, from black near the end. */
export async function detectCredits(filePath: string, duration: number): Promise<number | null> {
  if (duration < 120) return null;
  const from = Math.floor(duration * (1 - CREDITS_SCAN_SHARE));
  // Small frames and only reference frames: the picture only has to be judged dark or not.
  const { stderr } = await ffmpeg(['-loglevel', 'info', '-skip_frame', 'noref', '-ss', String(from), '-i', filePath, '-map', '0:v:0', '-an', '-sn',
    '-vf', 'scale=160:-2,blackdetect=d=2:pic_th=0.9:pix_th=0.12', '-f', 'null', '-'], false);
  return creditsFromBlack(parseBlackdetect(stderr, from), duration);
}

const queued = new Set<string>();
let chain: Promise<void> = Promise.resolve();

/** Runs jobs strictly one after another, each once while it is waiting. */
function enqueue(key: string, job: () => Promise<void>): void {
  if (queued.has(key)) return;
  queued.add(key);
  chain = chain.then(job).catch(() => undefined).finally(() => { queued.delete(key); });
}

/** Look for credits in a file in the background, unless a chapter already marks them or it was checked. */
export function queueCredits(filePath: string): void {
  if (rowFor(filePath)?.credits_checked) return;
  enqueue(`credits:${filePath}`, async () => {
    if (rowFor(filePath)?.credits_checked) return;
    const probe = await probeMedia(filePath);
    let start: number | null = null;
    // The player already offers a skip for a credits chapter.
    if (!(probe.chapters ?? []).some(c => CREDITS_CHAPTER.test(c.title.trim()))) {
      try { start = await detectCredits(filePath, probe.durationSeconds ?? 0); } catch { /* unreadable file: no button */ }
    }
    save(filePath, { credits: start });
  });
}

/** Compare one season's episodes (in episode order) and store an intro for each that has not been checked. */
export function queueSeason(files: string[]): void {
  if (files.length < 2 || files.every(f => rowFor(f)?.intro_checked)) return;
  enqueue(`intro:${files.join('|')}`, async () => {
    const prints: number[][] = [];
    for (const f of files) {
      try { prints.push(await fingerprintFile(f)); } catch { prints.push([]); }
    }
    seasonIntros(prints).forEach((intro, i) => { if (!rowFor(files[i]!)?.intro_checked) save(files[i]!, { intro }); });
  });
}

/**
 * Queue intro detection for every season of a show and a credits check for each episode.
 * Returns how many episodes have files; finding their paths carries on in the background.
 */
export async function detectSeries(seriesId: string): Promise<number> {
  const sonarr = getAdapter<SonarrAdapter>('sonarr');
  const episodes = (await sonarr.getEpisodes(seriesId)).filter(e => e.hasFile);
  void (async () => {
    const seasons = new Map<number, string[]>();
    for (const e of episodes) {
      const file = (await sonarr.getEpisodeFile(e.id).catch(() => null))?.path;
      if (file && fileStamp(file)) seasons.set(e.seasonNumber, [...(seasons.get(e.seasonNumber) ?? []), file]);
    }
    for (const files of seasons.values()) {
      queueSeason(files);
      files.forEach(queueCredits);
    }
  })().catch(() => undefined);
  return episodes.length;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
