import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { probeMedia, resolveBinary } from './transcode.js';

// Preview thumbnails on the seek bar: one small picture every INTERVAL seconds,
// packed into a single sprite image made once per file by ffmpeg and cached.

export interface TrickplayMeta { interval: number; width: number; height: number; cols: number; rows: number; count: number }
export type TrickplayState =
  | { state: 'ready'; meta: TrickplayMeta; image: string }
  | { state: 'pending' }
  | { state: 'unavailable' };

const INTERVAL = 10;
const WIDTH = 160;
const HEIGHT = 90;
const COLS = 10;
const DIR = resolve(DATA_DIR, 'trickplay');
const jobs = new Map<string, Promise<void>>();
const failed = new Set<string>();
let running = 0;
const waiting: Array<() => void> = [];

const keyFor = (filePath: string) => {
  const stat = statSync(filePath);
  return createHash('sha1').update(`${filePath}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 20);
};

function slot(): Promise<void> {
  if (running < 1) { running++; return Promise.resolve(); }
  return new Promise(ok => waiting.push(() => { running++; ok(); }));
}
function release(): void {
  running--;
  waiting.shift()?.();
}

async function generate(filePath: string, key: string): Promise<void> {
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) throw new Error('no ffmpeg');
  const probe = await probeMedia(filePath);
  const duration = probe.durationSeconds ?? 0;
  const count = Math.floor(duration / INTERVAL);
  if (count < 3) throw new Error('too short');
  const rows = Math.ceil(count / COLS);
  mkdirSync(DIR, { recursive: true });
  const image = resolve(DIR, `${key}.jpg`);
  const partial = resolve(DIR, `${key}.part.jpg`);
  await slot();
  try {
    await new Promise<void>((ok, fail) => {
      // Keyframes only: decoding every frame of a two hour film would take far longer.
      const child = spawn('nice', ['-n', '15', ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-skip_frame', 'nokey', '-i', filePath, '-an', '-sn',
        '-vf', `fps=1/${INTERVAL},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,tile=${COLS}x${rows}`,
        '-frames:v', '1', '-q:v', '6', '-f', 'image2', '-y', partial], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', d => { err += String(d); });
      child.on('error', fail);
      child.on('close', code => (code === 0 ? ok() : fail(new Error(err.slice(-200) || `ffmpeg exited ${code}`))));
    });
  } finally {
    release();
  }
  renameSync(partial, image);
  const meta: TrickplayMeta = { interval: INTERVAL, width: WIDTH, height: HEIGHT, cols: COLS, rows, count };
  writeFileSync(resolve(DIR, `${key}.json`), JSON.stringify(meta));
}

/** Ready sprite, or start making it in the background. */
export function trickplayFor(filePath: string): TrickplayState {
  if (!resolveBinary('ffmpeg')) return { state: 'unavailable' };
  let key: string;
  try { key = keyFor(filePath); } catch { return { state: 'unavailable' }; }
  const metaFile = resolve(DIR, `${key}.json`);
  const image = resolve(DIR, `${key}.jpg`);
  if (existsSync(metaFile) && existsSync(image)) {
    return { state: 'ready', meta: JSON.parse(readFileSync(metaFile, 'utf8')) as TrickplayMeta, image };
  }
  if (failed.has(key)) return { state: 'unavailable' };
  if (!jobs.has(key)) {
    const job = generate(filePath, key)
      .catch(() => { failed.add(key); })
      .finally(() => { jobs.delete(key); });
    jobs.set(key, job);
  }
  return { state: 'pending' };
}
