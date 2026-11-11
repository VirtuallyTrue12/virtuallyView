import { describe, expect, it } from 'vitest';
import { creditsFromBlack, fingerprint, longestSharedRun, parseBlackdetect, seasonIntros } from '../../apps/server/src/services/segments';

// Seeded random 32-bit codes, so each test is the same every run.
function codes(seed: number, n: number): number[] {
  let x = seed * 0x9e3779b9;
  return Array.from({ length: n }, () => {
    // mulberry32
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  });
}
/** Flip a few bits, the way re-encoded sound changes a code a little. */
const noisy = (list: number[], bits = 3) => list.map((c, i) => { let v = c; for (let b = 0; b < bits; b++) v ^= 1 << ((i * 7 + b * 11) % 32); return v >>> 0; });

describe('intro matching', () => {
  const theme = codes(99, 400); // 40 s

  it('finds a shared stretch at different offsets in two episodes', () => {
    const a = [...codes(1, 200), ...theme, ...codes(2, 1000)];
    const b = [...codes(3, 350), ...noisy(theme), ...codes(4, 900)];
    const run = longestSharedRun(a, b);
    expect(run).not.toBeNull();
    expect(Math.abs(run!.aStart - 200)).toBeLessThanOrEqual(5);
    expect(Math.abs(run!.aEnd - 600)).toBeLessThanOrEqual(5);
    expect(Math.abs(run!.bStart - 350)).toBeLessThanOrEqual(5);
  });

  it('finds nothing in unrelated sound, in silence, or in a stretch shorter than 10 s', () => {
    expect(longestSharedRun(codes(5, 1500), codes(6, 1500))).toBeNull();
    const silence = Array<number>(500).fill(-1);
    expect(longestSharedRun([...silence, ...codes(7, 500)], [...silence, ...codes(8, 500)])).toBeNull();
    const short = codes(9, 60);
    expect(longestSharedRun([...codes(10, 300), ...short], [...short, ...codes(11, 300)])).toBeNull();
  });

  it('gives each episode of a season its own intro times, and none to an episode without the theme', () => {
    const eps = [
      [...codes(20, 100), ...theme, ...codes(21, 800)],
      [...codes(22, 300), ...noisy(theme), ...codes(23, 800)],
      [...theme, ...codes(24, 800)],
      codes(25, 1200)
    ];
    const intros = seasonIntros(eps);
    expect(intros[0]).toEqual({ start: expect.closeTo(10, 0) as number, end: expect.closeTo(50, 0) as number });
    expect(intros[1]!.start).toBeCloseTo(30, 0);
    expect(intros[2]).toEqual({ start: 0, end: expect.closeTo(40, 0) as number });
    expect(intros[3]).toBeNull();
  });

  it('fingerprints sound the same way twice and marks silence', () => {
    const pcm = Int16Array.from({ length: 8000 * 3 }, (_, i) => Math.round(8000 * Math.sin(i * 0.05 + Math.sin(i * 0.0003) * 40)));
    const one = fingerprint(pcm);
    expect(one.length).toBeGreaterThan(25);
    expect(fingerprint(pcm)).toEqual(one);
    expect(fingerprint(new Int16Array(8000 * 2)).every(c => c === -1)).toBe(true);
  });
});

describe('credits decision', () => {
  it('takes a long black run that lasts to the end, joining short breaks', () => {
    expect(creditsFromBlack([{ start: 1300, end: 1330 }, { start: 1331, end: 1378 }], 1380)).toBe(1300);
  });

  it('offers nothing for a short run, or for black that stops before the end', () => {
    expect(creditsFromBlack([{ start: 1370, end: 1380 }], 1380)).toBeNull();
    expect(creditsFromBlack([{ start: 1200, end: 1300 }], 1380)).toBeNull();
    expect(creditsFromBlack([], 1380)).toBeNull();
  });

  it('reads blackdetect lines in file time', () => {
    const log = '[blackdetect @ 0x1] black_start:3.5 black_end:40.2 black_duration:36.7\nother line';
    expect(parseBlackdetect(log, 1000)).toEqual([{ start: 1003.5, end: 1040.2 }]);
  });
});
