import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RadioSource } from '../../apps/server/src/services/radio';

const dir = mkdtempSync(join(tmpdir(), 'vv-radio-rec-'));
process.env.VV_DATA_DIR = dir;
delete process.env.RECORDINGS_DIR;
const rec = await import('../../apps/server/src/services/radio-recordings');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const tone = join(dir, 'tone.mp3');
if (hasFfmpeg) spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', tone]);

/** Sends the tone once and ends (a short show), or keeps sending until closed. */
const station = (loop: boolean) => async (signal: AbortSignal): Promise<RadioSource> => {
  const bytes = readFileSync(tone);
  return { type: 'audio/mpeg', chunks: (async function* () { do { for (let i = 0; i < bytes.length && !signal.aborted; i += 16384) { yield bytes.subarray(i, i + 16384); await new Promise(r => setTimeout(r, 10)); } } while (loop && !signal.aborted); })() };
};
const settled = async (owner: string, id: string) => {
  for (let i = 0; i < 100; i++) { const r = rec.listRadioRecordings(owner).find(x => x.id === id); if (r && r.state !== 'recording') return r; await new Promise(res => setTimeout(res, 100)); }
  return rec.listRadioRecordings(owner).find(x => x.id === id);
};
const fm = { id: '11111111-2222-3333-4444-555555555555', name: 'Test FM 93.5' };

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!hasFfmpeg)('radio recordings', () => {
  it('records a show to a playable file that only its owner can see, get, stop or delete', async () => {
    const started = await rec.startRadioRecording('alice', fm, 1, station(false));
    if (!started.ok) throw new Error(started.message);
    const id = started.recording.id;
    expect(started.recording).toMatchObject({ owner: 'alice', stationId: fm.id, station: fm.name, state: 'recording' });

    expect(rec.listRadioRecordings('bob')).toEqual([]);
    expect(rec.radioRecordingFile('bob', id)).toBeNull();
    expect(rec.stopRadioRecording('bob', id)).toBe(false);
    expect(rec.deleteRadioRecording('bob', id)).toBe(false);

    const done = await settled('alice', id);
    expect(done?.state).toBe('done');
    const file = rec.radioRecordingFile('alice', id)!;
    expect(file).toMatch(/\.m4a$/);
    const seconds = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.toString());
    expect(seconds).toBeGreaterThan(5);
    expect(seconds).toBeLessThan(7);

    expect(rec.deleteRadioRecording('alice', id)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(rec.listRadioRecordings('alice')).toEqual([]);
  });

  it('checks the length, and limits how many run per person', async () => {
    for (const minutes of [0, 1.5, 241, Number.NaN]) expect(await rec.startRadioRecording('alice', fm, minutes, station(true))).toMatchObject({ ok: false, status: 400 });
    const a = await rec.startRadioRecording('alice', fm, 30, station(true));
    const b = await rec.startRadioRecording('alice', fm, 30, station(true));
    expect(a.ok && b.ok).toBe(true);
    expect(await rec.startRadioRecording('alice', fm, 30, station(true))).toMatchObject({ ok: false, status: 429 });
    expect(rec.activeRadioRecordings()).toHaveLength(2);
    // Stopped: the file is finished cleanly and kept.
    await new Promise(r => setTimeout(r, 1500));
    for (const r of [a, b]) if (r.ok) expect(rec.stopRadioRecording('alice', r.recording.id)).toBe(true);
    for (const r of [a, b]) if (r.ok) expect((await settled('alice', r.recording.id))?.state).toBe('stopped');
    expect(rec.activeRadioRecordings()).toHaveLength(0);
    expect(await rec.startRadioRecording('alice', fm, 1, async () => { throw new Error('The station answered 404.'); })).toMatchObject({ ok: false, status: 502 });
  });
});
