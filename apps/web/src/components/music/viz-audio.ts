import { audioEngine } from '../../lib/audio-engine';

/**
 * What the visualizers hear, worked out once per frame for every visualizer on screen from the player's one
 * AnalyserNode: a log-spaced spectrum (so bass, mids and highs each get their fair share of the picture) that
 * rises quickly and falls gently, and smoothed bass / mids / treble levels.
 */

export const BANDS = 128;
const LO = 35, HI = 16000;

/** Hz at the edge `x` (0..1) of the log-spaced range. */
const hzAt = (x: number) => LO * Math.pow(HI / LO, x);

/**
 * `freq` (analyser bins, 0..255, bin k at k * rate / 2 / bins Hz) to BANDS log-spaced bands, 0..1. A band wider
 * than a bin takes its loudest bin; the narrow bass bands, finer than the bins, read between them.
 */
export function logBands(freq: ArrayLike<number>, rate: number, out: Float32Array): Float32Array {
  const bins = freq.length, hzPerBin = rate / 2 / bins;
  for (let i = 0; i < out.length; i++) {
    const b0 = hzAt(i / out.length) / hzPerBin, b1 = hzAt((i + 1) / out.length) / hzPerBin;
    let m = 0;
    if (b1 - b0 < 1) {
      const c = Math.min(bins - 1.001, (b0 + b1) / 2), k = Math.floor(c), fr = c - k;
      m = (freq[k] ?? 0) * (1 - fr) + (freq[k + 1] ?? 0) * fr;
    } else for (let b = Math.floor(b0); b < Math.ceil(b1) && b < bins; b++) m = Math.max(m, freq[b] ?? 0);
    // Treble carries less energy in music: tilt it up a little so the high end is not always flat.
    // Expanded (power curve) so loud peaks stand out from the quieter bands instead of everything sitting level.
    out[i] = Math.min(1, Math.pow((m / 255) * (0.92 + (i / out.length) * 0.35), 1.35) * 1.2);
  }
  return out;
}

/**
 * One step of an envelope follower: towards `target` quickly when it rises (attack) and slowly when it falls
 * (release). The rates are per 60th of a second; `step` is how many 60ths this frame covers.
 */
export function follow(prev: number, target: number, step: number, attack = 0.6, release = 0.1): number {
  const k = target > prev ? attack : release;
  return prev + (target - prev) * (1 - Math.pow(1 - k, step));
}

/** Band `i` of `count` across the smoothed spectrum: the loudest of the bands it covers, interpolated when finer. */
export function bandOf(bands: Float32Array, i: number, count: number): number {
  const n = bands.length;
  const a = (i / count) * n, b = ((i + 1) / count) * n;
  if (b - a <= 1) {
    const c = Math.min(n - 1.001, Math.max(0, (a + b) / 2 - 0.5)), k = Math.floor(c), fr = c - k;
    return bands[k]! * (1 - fr) + bands[k + 1]! * fr;
  }
  let m = 0;
  for (let k = Math.floor(a); k < Math.ceil(b) && k < n; k++) m = Math.max(m, bands[k]!);
  return m;
}

/** Mean of the smoothed bands between two frequencies. */
function range(bands: Float32Array, hz0: number, hz1: number): number {
  const at = (hz: number) => Math.round((Math.log(hz / LO) / Math.log(HI / LO)) * bands.length);
  const k0 = Math.max(0, at(hz0)), k1 = Math.min(bands.length, Math.max(k0 + 1, at(hz1)));
  let s = 0;
  for (let k = k0; k < k1; k++) s += bands[k]!;
  return s / (k1 - k0);
}

export interface Audio {
  freq: Uint8Array<ArrayBuffer>; wave: Uint8Array<ArrayBuffer>;
  /** BANDS log-spaced bands, 0..1, smoothed. */
  bands: Float32Array;
  /** 0..1 energy, smoothed: 35-250 Hz, 250-4000 Hz, 4-16 kHz, and all three. */
  bass: number; mids: number; treble: number; level: number;
  /** Counts the beats so far: a canvas drawing at a lower rate still sees one that landed between its frames. */
  beats: number;
}

const raw = new Float32Array(BANDS);
const audio: Audio = { freq: new Uint8Array(1024), wave: new Uint8Array(2048), bands: new Float32Array(BANDS), bass: 0, mids: 0, treble: 0, level: 0, beats: 0 };
let lastTs = -1, bassAvg = 0, beatCool = 0;

/** The audio for the frame at `ts` (the rAF timestamp): read and smoothed once, shared by every visualizer. */
export function readAudio(ts: number, calm = false): Audio {
  if (ts === lastTs) return audio;
  const step = lastTs < 0 ? 1 : Math.min(4, Math.max(0.25, (ts - lastTs) / (1000 / 60)));
  lastTs = ts;
  const an = audioEngine.analyser;
  if (an) { an.getByteFrequencyData(audio.freq); an.getByteTimeDomainData(audio.wave); } else { audio.freq.fill(0); audio.wave.fill(128); }
  logBands(audio.freq, audioEngine.ctx?.sampleRate ?? 48000, raw);
  // The analyser already smooths; on top of it rise at once and fall fast, so hits land with their full punch.
  const atk = calm ? 0.5 : 1, rel = calm ? 0.12 : 0.3;
  for (let i = 0; i < BANDS; i++) audio.bands[i] = follow(audio.bands[i]!, raw[i]!, step, atk, rel);
  const bassNow = range(raw, 35, 250);
  audio.bass = follow(audio.bass, bassNow, step, atk, rel * 0.8);
  audio.mids = follow(audio.mids, range(raw, 250, 4000), step, atk, rel);
  audio.treble = follow(audio.treble, Math.min(1, range(raw, 4000, 16000) * 1.3), step, atk, rel);
  audio.level = (audio.bass + audio.mids + audio.treble) / 3;
  // A beat: the bass jumps well above its running average (and not twice within a quarter of a second).
  bassAvg += (bassNow - bassAvg) * (1 - Math.pow(0.95, step));
  beatCool -= step;
  if (!calm && beatCool <= 0 && bassNow > 0.22 && bassNow > bassAvg * 1.3) { audio.beats++; beatCool = 14; }
  return audio;
}

/**
 * The drawing resolution for the next stretch of frames, from how late the last ones came (rAF gaps, ms): a step
 * down when the slowest 5% take over 20 ms (and clearly longer than the screen's own refresh, so a 30 Hz TV is not
 * taken for a slow one), a step back up after five calm checks in a row.
 */
export function adaptQuality(gaps: number[], quality: number, calm: number): { quality: number; calm: number } {
  if (gaps.length < 20) return { quality, calm };
  const s = [...gaps].sort((a, b) => a - b);
  const p95 = s[Math.floor(s.length * 0.95)]!, vsync = s[Math.floor(s.length * 0.1)]!;
  if (p95 > 20 && p95 > vsync * 1.5) return { quality: Math.max(0.5, +(quality * 0.8).toFixed(3)), calm: 0 };
  if (p95 > 18 || quality >= 1) return { quality, calm: 0 };
  return calm + 1 >= 5 ? { quality: Math.min(1, +(quality * 1.15).toFixed(3)), calm: 0 } : { quality, calm: calm + 1 };
}
