import { describe, expect, it } from 'vitest';
import { categorize, isLowSpace, spaceCheck, suggest, SAFETY_MARGIN, type Activity, type PlanTitle } from '../../apps/server/src/services/storage-planner.js';

const GB = 1024 ** 3;
const DAY = 86_400_000;
const now = Date.parse('2026-11-11T00:00:00Z');
const title = (id: string, bytes: number, over: Partial<PlanTitle> = {}): PlanTitle => ({ id, title: id, kind: 'movie', bytes, quality: 'Bluray-1080p', addedAt: now - 400 * DAY, needed: 1, ...over });
const act = (lastDaysAgo: number, users: Activity['users']): Activity => ({ lastAt: now - lastDaysAgo * DAY, users });

describe('storage planner: size categories', () => {
  it('adds folders of one category, sorts biggest first, drops empty ones', () => {
    const out = categorize([{ category: 'cache', bytes: 2 }, { category: 'movies', bytes: 100 }, { category: 'cache', bytes: 3 }, { category: 'backups', bytes: 0 }]);
    expect(out.map(c => [c.id, c.bytes])).toEqual([['movies', 100], ['cache', 5]]);
    expect(out[1]!.label).toBe('Offline and transcode cache');
  });
});

describe('storage planner: what to suggest deleting', () => {
  const done = { a: { finished: 1, partial: false } };
  it('suggests finished, untouched titles, biggest first', () => {
    const acts = new Map([['small', act(120, done)], ['big', act(200, done)]]);
    expect(suggest([title('small', GB), title('big', 9 * GB)], acts, 90, now).map(t => t.id)).toEqual(['big', 'small']);
  });
  it('skips recent activity, unfinished viewers, unwatched and newly added titles', () => {
    const acts = new Map<string, Activity>([
      ['recent', act(10, done)],
      ['partial', act(200, { a: { finished: 1, partial: false }, b: { finished: 0, partial: true } })],
      ['newadd', act(200, done)]
    ]);
    const titles = [title('recent', GB), title('partial', GB), title('never', GB), title('newadd', GB, { addedAt: now - 5 * DAY })];
    expect(suggest(titles, acts, 90, now)).toEqual([]);
  });
  it('a show counts only when every episode is finished, or the whole show is marked watched', () => {
    const show = title('show', GB, { kind: 'series', needed: 10 });
    expect(suggest([show], new Map([['show', act(200, { a: { finished: 6, partial: false } })]]), 90, now)).toEqual([]);
    expect(suggest([show], new Map([['show', act(200, { a: { finished: 10, partial: false } })]]), 90, now)).toHaveLength(1);
    expect(suggest([show], new Map([['show', act(200, { a: { finished: Number.MAX_SAFE_INTEGER, partial: false } })]]), 90, now)).toHaveLength(1);
  });
});

describe('storage planner: space check', () => {
  it('blocks a file that would eat into the 10 GB margin, with a plain message', () => {
    expect(spaceCheck(12 * GB, 30 * GB)).toEqual({ ok: false, message: 'Not enough space for this 30 GB file: 12 GB free.' });
    expect(spaceCheck(12 * GB, 2 * GB).ok).toBe(true);
    expect(spaceCheck(12 * GB, 2 * GB + 1).ok).toBe(false);
  });
  it('without a known size only a nearly full disk blocks; unreadable disks never do', () => {
    expect(spaceCheck(SAFETY_MARGIN, 0).ok).toBe(false);
    expect(spaceCheck(SAFETY_MARGIN + GB, 0).ok).toBe(true);
    expect(spaceCheck(null, 500 * GB).ok).toBe(true);
  });
  it('warns below 10 percent or 20 GB', () => {
    expect(isLowSpace(15 * GB, 4000 * GB)).toBe(true);
    expect(isLowSpace(150 * GB, 2000 * GB)).toBe(true);
    expect(isLowSpace(300 * GB, 2000 * GB)).toBe(false);
  });
});
