import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { RadioSource } from '../../apps/server/src/services/radio';

const dir = mkdtempSync(join(tmpdir(), 'vv-timeshift-'));
process.env.VV_DATA_DIR = dir;
const ts = await import('../../apps/server/src/services/radio-timeshift');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tone = join(dir, 'tone.mp3');
if (hasFfmpeg) spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', tone]);

/** A station that loops a tone (faster than real time) until it is closed. */
const looping = (opened: string[], name: string) => async (signal: AbortSignal): Promise<RadioSource> => {
  opened.push(name);
  const bytes = readFileSync(tone);
  return { type: 'audio/mpeg', chunks: (async function* () { while (!signal.aborted) { for (let i = 0; i < bytes.length && !signal.aborted; i += 16384) { yield bytes.subarray(i, i + 16384); await new Promise(r => setTimeout(r, 20)); } } })() };
};
const silent = async (signal: AbortSignal): Promise<RadioSource> => ({ type: 'audio/mpeg', chunks: (async function* () { while (!signal.aborted) await new Promise(r => setTimeout(r, 50)); })() });
const alive = (pid: number | undefined) => { try { return !!pid && process.kill(pid, 0); } catch { return false; } };
const gone = async (pids: Array<number | undefined>) => { for (let i = 0; i < 50 && pids.some(alive); i++) await new Promise(r => setTimeout(r, 100)); return !pids.some(alive); };
const defaults = { ...ts.LIMITS };

afterEach(async () => {
  const pids = ts.activeBuffers().map(b => b.pid);
  for (const b of ts.activeBuffers()) ts.stopBuffer(b.id);
  await gone(pids);
  Object.assign(ts.LIMITS, defaults);
  vi.restoreAllMocks();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('radio timeshift: ffmpeg settings', () => {
  it('copies MP3, AAC and HLS audio and converts anything else to AAC, keeping 30 minutes', () => {
    expect(ts.copies('audio/mpeg')).toBe(true);
    expect(ts.copies('audio/aacp')).toBe(true);
    expect(ts.copies('hls')).toBe(true);
    expect(ts.copies('application/ogg')).toBe(false);
    const args = ts.ffmpegArgs('audio/ogg', '/x').join(' ');
    expect(args).toContain('-i pipe:0');
    expect(args).toContain('-c:a aac');
    expect(args).toContain(`-hls_list_size ${ts.WINDOW_SECONDS / ts.SEGMENT_SECONDS}`);
    expect(args).toContain('delete_segments');
  });
});

describe.skipIf(!hasFfmpeg)('radio timeshift: buffer lifecycle and limits', () => {
  it('buffers a station once for everyone, and serves its playlist and segments', async () => {
    const opened: string[] = [];
    expect(await ts.ensureBuffer('station-a', 'u1', looping(opened, 'a'))).toEqual({ ok: true });
    expect(await ts.ensureBuffer('station-a', 'u2', looping(opened, 'a2'))).toEqual({ ok: true });
    expect(opened).toEqual(['a']);
    const playlist = ts.readPlaylist('station-a', 'u2')!;
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toMatch(/seg00000\.ts/);
    expect(existsSync(ts.segmentFile('station-a', 'seg00000.ts')!)).toBe(true);
    expect(ts.segmentFile('station-a', '../index.m3u8')).toBeNull();
    expect(ts.segmentFile('nope', 'seg00000.ts')).toBeNull();
    expect(ts.readPlaylist('nope', 'u1')).toBeNull();
  });

  it('limits stations per person and in total', async () => {
    ts.LIMITS.perPerson = 1;
    ts.LIMITS.buffers = 2;
    const opened: string[] = [];
    expect((await ts.ensureBuffer('a', 'u1', looping(opened, 'a'))).ok).toBe(true);
    expect(await ts.ensureBuffer('b', 'u1', looping(opened, 'b'))).toMatchObject({ ok: false, status: 429 });
    expect((await ts.ensureBuffer('b', 'u2', looping(opened, 'b'))).ok).toBe(true);
    // Both in use a moment ago: no room, and nothing is cut off.
    expect(await ts.ensureBuffer('c', 'u3', looping(opened, 'c'))).toMatchObject({ ok: false, status: 503 });
    expect(ts.activeBuffers()).toHaveLength(2);
    // A minute later the one left alone longest makes room.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    expect((await ts.ensureBuffer('c', 'u3', looping(opened, 'c'))).ok).toBe(true);
    expect(ts.activeBuffers().map(b => b.id).sort()).toEqual(['b', 'c']);
  });

  it('stops ffmpeg and deletes the files when nobody listens for 5 minutes', async () => {
    await ts.ensureBuffer('idle', 'u1', looping([], 'idle'));
    const [buf] = ts.activeBuffers();
    expect(alive(buf!.pid)).toBe(true);
    ts.sweep(Date.now() + ts.LIMITS.idleMs - 5000);
    expect(ts.activeBuffers()).toHaveLength(1);
    ts.sweep(Date.now() + ts.LIMITS.idleMs + 1000);
    expect(ts.activeBuffers()).toHaveLength(0);
    expect(await gone([buf!.pid])).toBe(true);
    await new Promise(r => setTimeout(r, 100));
    expect(existsSync(join(dir, 'radio-buffer', 'idle'))).toBe(false);
  });

  it('stops a buffer that grows past its size cap', async () => {
    await ts.ensureBuffer('big', 'u1', looping([], 'big'));
    ts.LIMITS.bytes = 10;
    ts.sweep();
    expect(ts.activeBuffers()).toHaveLength(0);
  });

  it('gives up cleanly on a station that sends nothing, or does not answer', async () => {
    ts.LIMITS.startMs = 1500;
    expect(await ts.ensureBuffer('quiet', 'u1', silent)).toMatchObject({ ok: false, status: 502 });
    expect(ts.activeBuffers()).toHaveLength(0);
    expect(await ts.ensureBuffer('down', 'u1', async () => { throw new Error('The station answered 404.'); })).toEqual({ ok: false, status: 502, message: 'The station answered 404.' });
    // The ffmpeg started for the quiet one is gone too.
    const running = () => spawnSync('ps', ['-eo', 'args']).stdout.toString().includes(join(dir, 'radio-buffer', 'quiet'));
    for (let i = 0; i < 30 && running(); i++) await new Promise(r => setTimeout(r, 100));
    expect(running()).toBe(false);
  });
});
