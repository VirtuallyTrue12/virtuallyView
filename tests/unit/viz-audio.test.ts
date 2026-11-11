import { describe, expect, it } from 'vitest';
import { adaptQuality, bandOf, BANDS, follow, logBands } from '../../apps/web/src/components/music/viz-audio';

const hzToBin = (hz: number) => Math.round(hz / (48000 / 2 / 1024));

describe('visualizer band mapping', () => {
  it('puts a bass note in the low bands and a hi-hat in the high ones', () => {
    const freq = new Uint8Array(1024);
    freq[hzToBin(60)] = 255;
    const low = logBands(freq, 48000, new Float32Array(BANDS));
    const peak = low.indexOf(Math.max(...low));
    expect(peak).toBeLessThan(BANDS * 0.15);

    freq.fill(0); freq[hzToBin(10000)] = 255;
    const high = logBands(freq, 48000, new Float32Array(BANDS));
    expect(high.indexOf(Math.max(...high))).toBeGreaterThan(BANDS * 0.8);
  });

  it('spreads octaves evenly: 100-200 Hz gets as many bands as 4-8 kHz', () => {
    const count = (lo: number, hi: number) => {
      const freq = new Uint8Array(1024);
      for (let b = hzToBin(lo); b <= hzToBin(hi); b++) freq[b] = 200;
      return logBands(freq, 48000, new Float32Array(BANDS)).filter(v => v > 0.3).length;
    };
    // An octave is 128 / log2(16000 / 35) = 14.5 bands; in the bass the analyser's 23 Hz bins blur the edges.
    for (const n of [count(100, 200), count(1000, 2000), count(4000, 8000)]) { expect(n).toBeGreaterThanOrEqual(13); expect(n).toBeLessThanOrEqual(23); }
  });

  it('reads any band count from the 128 bands, interpolating when finer', () => {
    const bands = new Float32Array(BANDS).map((_, i) => i / (BANDS - 1));
    expect(bandOf(bands, 0, 8)).toBeCloseTo(15 / 127, 3); // loudest of bands 0..15
    expect(bandOf(bands, 7, 8)).toBeCloseTo(1, 3);
    const fine = Array.from({ length: 512 }, (_, i) => bandOf(bands, i, 512));
    for (let i = 1; i < fine.length; i++) expect(fine[i]!).toBeGreaterThanOrEqual(fine[i - 1]!);
  });
});

describe('visualizer smoothing', () => {
  it('rises fast and falls slowly', () => {
    expect(follow(0, 1, 1)).toBeCloseTo(0.6);
    expect(follow(1, 0, 1)).toBeCloseTo(0.9);
  });

  it('gives the same motion whatever the frame rate', () => {
    let a = 0, b = 0;
    for (let i = 0; i < 6; i++) a = follow(a, 1, 1, 0.3);
    for (let i = 0; i < 3; i++) b = follow(b, 1, 2, 0.3);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('visualizer adaptive quality', () => {
  const frames = (ms: number, slow = 0, slowMs = 40) => Array.from({ length: 60 }, (_, i) => (i < slow ? slowMs : ms));

  it('steps down when one frame in twenty runs late', () => {
    expect(adaptQuality(frames(16.7, 6), 1, 0).quality).toBeLessThan(1);
    expect(adaptQuality(frames(16.7, 6), 0.5, 0).quality).toBe(0.5);
  });

  it('leaves a steady 30 Hz screen alone', () => {
    expect(adaptQuality(frames(33.3), 1, 0)).toEqual({ quality: 1, calm: 0 });
  });

  it('steps back up only after five calm checks', () => {
    let s = { quality: 0.64, calm: 0 };
    for (let i = 0; i < 4; i++) { s = adaptQuality(frames(16.7), s.quality, s.calm); expect(s.quality).toBe(0.64); }
    s = adaptQuality(frames(16.7), s.quality, s.calm);
    expect(s.quality).toBeGreaterThan(0.64);
  });

  it('waits for enough frames', () => {
    expect(adaptQuality([50, 50], 1, 0).quality).toBe(1);
  });
});
