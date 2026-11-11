import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'vv-sched-'));

// No real ffmpeg, disk or channel list: the scheduler's own decisions are what is tested.
const fake = vi.hoisted(() => ({ started: [] as Array<{ minutes: number; title?: string }>, free: 100 * 1024 ** 3 as number | null, notes: [] as string[], states: new Map<string, string>() }));
vi.mock('../../apps/server/src/services/recordings.js', () => ({
  recordingsDir: () => '/tmp',
  recordingState: (id: string) => fake.states.get(id),
  stopRecording: () => true,
  startRecording: (_u: string, _c: string, minutes: number, title?: string) => {
    fake.started.push({ minutes, title });
    const id = `rec${fake.started.length}`;
    fake.states.set(id, 'recording');
    return { ok: true, recording: { id } };
  }
}));
vi.mock('../../apps/server/src/services/storage-planner.js', () => ({ SAFETY_MARGIN: 10 * 1024 ** 3, freeBytesAt: async () => fake.free }));
vi.mock('../../apps/server/src/services/live-tv.js', () => ({ channelById: async (id: string) => (id === 'gone' ? null : { id, name: `Chan ${id}`, url: 'http://x/s.m3u8' }) }));
vi.mock('../../apps/server/src/services/notifications.js', () => ({ notify: (n: { title: string }) => { fake.notes.push(n.title); } }));

type S = typeof import('../../apps/server/src/services/recording-scheduler.js');
let s: S;
let run: (sql: string) => unknown;
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 12, 20, 0, 0);
const air = (over: Partial<Parameters<S['schedule']>[0]> = {}) => ({ channelId: 'a', channel: 'Chan a', start: T0 + 60 * MIN, stop: T0 + 120 * MIN, title: 'News', ...over });
const rowOf = (id: string) => s.listSchedule().find(r => r.id === id)!;

beforeAll(async () => {
  s = await import('../../apps/server/src/services/recording-scheduler.js');
  const d = (await import('../../apps/server/src/db/app-db.js')).db();
  run = q => d.exec(q);
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); fake.started.length = 0; fake.free = 100 * 1024 ** 3; fake.notes.length = 0; fake.states.clear(); run('DELETE FROM rec_schedule; DELETE FROM rec_series;'); });
afterEach(() => { vi.useRealTimers(); });

describe('recording scheduler', () => {
  it('starts one minute early and records until three minutes after the end', async () => {
    const r = s.schedule(air(), T0);
    expect(r.ok).toBe(true);
    vi.setSystemTime(T0 + 58 * MIN); await s.tick();
    expect(fake.started).toHaveLength(0);
    vi.setSystemTime(T0 + 59 * MIN); await s.tick();
    expect(fake.started).toEqual([{ minutes: 64, title: 'News' }]); // 1 min before + 60 min + 3 min after
  });

  it('a programme already on air records from now to its padded end', async () => {
    s.schedule(air({ start: T0 - 10 * MIN, stop: T0 + 20 * MIN }), T0);
    await s.tick(T0);
    expect(fake.started[0]!.minutes).toBe(23);
  });

  it('refuses a programme that already finished', () => {
    expect(s.schedule(air({ start: T0 - 60 * MIN, stop: T0 - 1 }), T0).ok).toBe(false);
  });

  it('after a restart: still on air begins late, over is marked missed', async () => {
    const live = s.schedule(air({ start: T0 + 10 * MIN, stop: T0 + 70 * MIN, title: 'Live' }), T0);
    const over = s.schedule(air({ start: T0 + 10 * MIN, stop: T0 + 40 * MIN, title: 'Over' }), T0);
    await s.tick(T0 + 50 * MIN);
    expect(rowOf((live as { row: { id: string } }).row.id).state).toBe('recording');
    expect(fake.started).toEqual([{ minutes: 23, title: 'Live' }]);
    const o = rowOf((over as { row: { id: string } }).row.id);
    expect(o.state).toBe('missed');
    expect(o.message).toMatch(/not running/);
  });

  it('allows two at once, shows the third as a conflict before it happens, and marks it when it starts', async () => {
    const ids = ['A', 'B', 'C'].map(title => (s.schedule(air({ title }), T0) as { row: { id: string } }).row.id);
    expect(ids.map(id => rowOf(id).conflict)).toEqual([false, false, true]);
    await s.tick(T0 + 59 * MIN);
    expect(fake.started).toHaveLength(2);
    expect(rowOf(ids[2]!).state).toBe('conflict');
  });

  it('a recording that ends frees its slot and is marked done', async () => {
    const id = (s.schedule(air(), T0) as { row: { id: string } }).row.id;
    await s.tick(T0 + 59 * MIN);
    fake.states.set('rec1', 'done');
    await s.tick(T0 + 60 * MIN);
    expect(rowOf(id).state).toBe('done');
  });

  it('series: matches future airings on its channel, skips the same episode, and ignores other titles', () => {
    s.addSeries('Quiz', 'a', 'Chan a', T0);
    const guide = { a: [
      { start: T0 + 60 * MIN, stop: T0 + 90 * MIN, title: 'quiz', sub: 'Ep 1' },
      { start: T0 + 24 * 60 * MIN, stop: T0 + 25 * 60 * MIN, title: 'Quiz', sub: 'Ep 1' }, // a rerun of the same episode
      { start: T0 + 25 * 60 * MIN, stop: T0 + 26 * 60 * MIN, title: 'Quiz', sub: 'Ep 2' },
      { start: T0 + 30 * MIN, stop: T0 + 40 * MIN, title: 'Other' },
      { start: T0 - 10 * MIN, stop: T0 + 10 * MIN, title: 'Quiz', sub: 'Ep 0' } // already started
    ], b: [{ start: T0 + 60 * MIN, stop: T0 + 90 * MIN, title: 'Quiz', sub: 'Ep 3' }] };
    expect(s.matchSeries(guide, id => `Chan ${id}`, T0)).toBe(2);
    expect(s.matchSeries(guide, id => `Chan ${id}`, T0)).toBe(0); // the same guide again adds nothing
    expect(s.listSchedule().map(r => r.sub)).toEqual(['Ep 1', 'Ep 2']);
  });

  it('series on any channel matches every channel, and deleting the rule drops what it scheduled', () => {
    const rule = s.addSeries('Quiz', null, null, T0);
    s.matchSeries({ b: [{ start: T0 + 60 * MIN, stop: T0 + 90 * MIN, title: 'Quiz', sub: 'Ep 3' }] }, () => 'Chan b', T0);
    expect(s.listSchedule()).toHaveLength(1);
    expect(s.deleteSeries(rule.id)).toBe(true);
    expect(s.listSchedule()).toHaveLength(0);
  });

  it('without a sub-title, only the very same airing is a duplicate', () => {
    expect(s.schedule(air(), T0).ok).toBe(true);
    expect(s.schedule(air(), T0).ok).toBe(false);
    expect(s.schedule(air({ start: T0 + 24 * 60 * MIN, stop: T0 + 25 * 60 * MIN }), T0).ok).toBe(true);
  });

  it('refuses to start under 10 GB free and tells an administrator', async () => {
    fake.free = 5 * 1024 ** 3;
    const id = (s.schedule(air(), T0) as { row: { id: string } }).row.id;
    await s.tick(T0 + 59 * MIN);
    expect(fake.started).toHaveLength(0);
    expect(rowOf(id).state).toBe('failed');
    expect(rowOf(id).message).toMatch(/free space/);
    expect(fake.notes).toHaveLength(1);
  });

  it('survives in the database and can be cancelled', () => {
    const id = (s.schedule(air(), T0) as { row: { id: string } }).row.id;
    expect(s.listSchedule()).toHaveLength(1);
    expect(s.cancelSchedule(id)).toBe(true);
    expect(s.cancelSchedule(id)).toBe(false);
  });
});
