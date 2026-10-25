import type { GlScene } from './viz-gl';
import { auroraGl, colorsGl, fireGl, juliaGl, kaleidoGl, mandelbrotGl, mistGl, plasmaGl, sierpinskiGl, tunnelGl } from './viz-gl-scenes';

/**
 * The visualizer scenes. Each draws one frame from what the player's analyser hears (see Visualizer.tsx for the
 * loop). All original drawings in the spirit of the classic desktop media players. A scene may keep state between
 * frames (`setup` makes it, once per canvas and scene).
 */

export type Variant = 'full' | 'strip' | 'tile';

export interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number; h: number; dpr: number; variant: Variant;
  /** Time in 60ths of a second (frames at 60), and how many of those this frame covers (2 at 30 fps). */
  t: number; step: number;
  freq: Uint8Array; wave: Uint8Array;
  /** 0..1 energy in the low, middle and high range, and overall. */
  bass: number; mids: number; treble: number; level: number;
  /** A slowly turning colour, nudged by the bass. */
  hue: number;
  /** True on the frame a beat lands. */
  beat: boolean;
  tint: [number, number, number];
  /** One of `count` log-spaced bands from 35 Hz to 16 kHz, 0..1. */
  band(i: number, count: number): number;
  /** Like band, but folded so a ring of `count` points meets itself without a seam. */
  ring(i: number, count: number): number;
}

export interface Scene {
  id: string;
  name: string;
  /** Drawn on the GPU when the browser can (see viz-gl); `draw` is then only the fallback. */
  gl?: GlScene & { setup?: () => unknown };
  setup?: (f: Frame) => unknown;
  /** The 2D drawing; scenes drawn on the GPU (`gl`) have none. */
  draw?: (f: Frame, state: never) => void;
}

const TAU = Math.PI * 2;
const fade = (f: Frame, rgba: string) => { f.ctx.fillStyle = rgba; f.ctx.fillRect(0, 0, f.w, f.h); };
const small = (f: Frame) => f.variant === 'tile';
/** True on the frame that crosses a multiple of `n` sixtieths of a second (frames may be 1, 2 or 2.5 apart). */
const every = (f: { t: number; step: number }, n: number) => Math.floor(f.t / n) !== Math.floor((f.t - f.step) / n);
/** Canvas glow is costly per pixel: sized for the pixel density, and left off on very large canvases (2K, 4K). */
const glow = (f: Frame, px: number) => (small(f) || f.w * f.h * f.dpr * f.dpr > 2_400_000 ? 0 : px * f.dpr);

function roundTop(ctx: CanvasRenderingContext2D, x: number, y: number, bw: number, bh: number) {
  const r = Math.min(bw / 2, 4, bh);
  ctx.beginPath();
  ctx.moveTo(x, y + bh); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + bw - r, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + r); ctx.lineTo(x + bw, y + bh); ctx.closePath();
  ctx.fill();
}

// ---------- Bars and spectrum ----------

type BarsState = { n: number; level: Float32Array; peaks: Float32Array; vel: Float32Array };
const bars: Scene = {
  id: 'bars', name: 'Bars',
  setup: f => { const n = f.variant === 'strip' ? 120 : small(f) ? 18 : 72; return { n, level: new Float32Array(n), peaks: new Float32Array(n), vel: new Float32Array(n) }; },
  draw: (f, s: BarsState) => {
    const { ctx, w, h, variant, tint: [tr, tg, tb], hue } = f;
    const strip = variant === 'strip';
    ctx.clearRect(0, 0, w, h);
    if (!strip) { const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, 'rgba(8,10,18,1)'); bg.addColorStop(1, `rgba(${tr},${tg},${tb},0.16)`); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    const floor = strip ? h : h * (small(f) ? 0.92 : 0.8);
    const room = strip ? h : floor * 0.9;
    const gap = strip ? 1 : small(f) ? 2 : 3;
    const bw = Math.max(1, w / s.n - gap);
    const g = ctx.createLinearGradient(0, floor, 0, floor - room);
    g.addColorStop(0, `rgba(${tr},${tg},${tb},0.95)`);
    g.addColorStop(0.55, `hsla(${hue % 360},85%,62%,0.95)`);
    g.addColorStop(1, `hsla(${(hue + 60) % 360},95%,75%,1)`);
    for (let i = 0; i < s.n; i++) {
      const target = f.band(i, s.n);
      // Fast attack, slower fall: the motion reads as music rather than flicker.
      s.level[i] = target > s.level[i]! ? s.level[i]! + (target - s.level[i]!) * 0.6 : s.level[i]! * 0.9;
      const bh = Math.max(strip ? 0 : 2, s.level[i]! * room);
      if (bh >= s.peaks[i]!) { s.peaks[i] = bh; s.vel[i] = 0; } else { s.vel[i]! += 0.25; s.peaks[i] = Math.max(0, s.peaks[i]! - s.vel[i]! * 0.35); }
      const x = i * (bw + gap) + gap / 2;
      ctx.fillStyle = g;
      if (strip) { ctx.globalAlpha = 0.85; ctx.fillRect(x, floor - bh, bw, bh); ctx.globalAlpha = 1; continue; }
      roundTop(ctx, x, floor - bh, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x, floor - s.peaks[i]! - 4, bw, 2);
      if (variant === 'full') { ctx.globalAlpha = 0.18; ctx.fillStyle = g; ctx.fillRect(x, floor + 2, bw, Math.min(h - floor - 2, bh * 0.35)); ctx.globalAlpha = 1; }
    }
  }
};

type LedState = { peaks: Float32Array; hold: Float32Array };
const led: Scene = {
  id: 'led', name: 'LED meter',
  setup: () => ({ peaks: new Float32Array(32), hold: new Float32Array(32) }),
  draw: (f, s: LedState) => {
    const { ctx, w, h } = f;
    ctx.fillStyle = '#07080c'; ctx.fillRect(0, 0, w, h);
    const cols = small(f) ? 12 : 28, rows = small(f) ? 10 : 20;
    const padX = w * 0.06, padY = h * 0.1, cw = (w - padX * 2) / cols, rh = (h - padY * 2) / rows;
    for (let c = 0; c < cols; c++) {
      const v = f.band(c, cols);
      const lit = Math.round(v * rows);
      if (lit >= s.peaks[c]!) { s.peaks[c] = lit; s.hold[c] = 30; } else if (s.hold[c]! > 0) s.hold[c]!--; else s.peaks[c] = Math.max(0, s.peaks[c]! - 0.4);
      for (let r = 0; r < rows; r++) {
        const on = r < lit || r === Math.floor(s.peaks[c]!);
        const frac = r / rows;
        const color = frac > 0.8 ? [255, 70, 60] : frac > 0.6 ? [255, 200, 40] : [60, 230, 120];
        ctx.fillStyle = on ? `rgb(${color.join(',')})` : `rgba(${color.join(',')},0.08)`;
        if (on) { ctx.shadowColor = `rgb(${color.join(',')})`; ctx.shadowBlur = glow(f, 8); }
        ctx.fillRect(padX + c * cw + 1.5, h - padY - (r + 1) * rh + 1.5, cw - 3, rh - 3);
        ctx.shadowBlur = 0;
      }
    }
  }
};

const radial: Scene = {
  id: 'radial', name: 'Radial',
  draw: f => {
    const { ctx, w, h, hue, bass, tint: [tr, tg, tb] } = f;
    fade(f, 'rgba(4,5,12,0.3)');
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * (0.2 + bass * 0.05), count = small(f) ? 48 : 144;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(f.t * 0.002);
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const v = f.ring(i, count);
      const len = 4 + v * Math.min(w, h) * 0.3;
      const a = (i / count) * TAU;
      ctx.strokeStyle = `hsla(${(hue + (i / count) * 360) % 360},90%,${55 + v * 20}%,0.95)`;
      ctx.lineWidth = Math.max(1.5, (TAU * R) / count - 2);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R + len), Math.sin(a) * (R + len)); ctx.stroke();
    }
    ctx.restore();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.95);
    g.addColorStop(0, `rgba(${tr},${tg},${tb},${0.5 + bass * 0.5})`); g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.95, 0, TAU); ctx.fill();
  }
};

const pulse: Scene = {
  id: 'pulse', name: 'Pulse',
  draw: f => {
    const { ctx, w, h, hue, bass } = f;
    fade(f, 'rgba(3,4,10,0.35)');
    const count = small(f) ? 24 : 64, bw = w / (count * 2);
    for (let i = 0; i < count; i++) {
      const v = f.band(i, count);
      const bh = Math.max(2, v * h * 0.46);
      ctx.fillStyle = `hsla(${(hue + i * 4) % 360},90%,${50 + v * 25}%,0.95)`;
      for (const x of [w / 2 + i * bw, w / 2 - (i + 1) * bw]) ctx.fillRect(x + 1, h / 2 - bh, bw - 2, bh * 2);
    }
    ctx.fillStyle = `rgba(255,255,255,${0.15 + bass * 0.5})`; ctx.fillRect(0, h / 2 - 1, w, 2);
  }
};

const spikes: Scene = {
  id: 'spikes', name: 'Spikes',
  draw: f => {
    const { ctx, w, h, hue, bass } = f;
    fade(f, 'rgba(2,2,8,0.25)');
    const cx = w / 2, cy = h / 2, base = Math.min(w, h) * 0.12, n = small(f) ? 24 : 64;
    ctx.save(); ctx.translate(cx, cy); ctx.globalCompositeOperation = 'lighter';
    for (const [dir, scale, shift] of [[1, 1, 0], [-1, 0.6, 120]] as const) {
      ctx.save(); ctx.rotate(dir * f.t * 0.006); ctx.scale(scale, scale);
      ctx.beginPath();
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * TAU;
        const r = i % 2 ? base * (1 + bass) : base + f.ring(i / 2, n) * Math.min(w, h) * 0.42;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(0, 0, base * 0.5, 0, 0, Math.min(w, h) * 0.5);
      g.addColorStop(0, `hsla(${(hue + shift) % 360},95%,55%,0.18)`); g.addColorStop(0.5, `hsla(${(hue + shift + 40) % 360},95%,60%,0.3)`); g.addColorStop(1, `hsla(${(hue + shift + 80) % 360},95%,50%,0.08)`);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = `hsla(${(hue + shift) % 360},100%,75%,0.7)`; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    }
    ctx.restore(); ctx.globalCompositeOperation = 'source-over';
  }
};

type VuState = { l: number; r: number };
const vu: Scene = {
  id: 'vu', name: 'VU meters',
  setup: () => ({ l: 0, r: 0 }),
  draw: (f, s: VuState) => {
    const { ctx, w, h } = f;
    ctx.fillStyle = '#121010'; ctx.fillRect(0, 0, w, h);
    // No separate channels from the analyser: one meter shows the lows, the other the highs.
    let lo = 0, hi = 0;
    for (let i = 0; i < 8; i++) lo += f.band(i, 24);
    for (let i = 12; i < 24; i++) hi += f.band(i, 24);
    s.l += ((lo / 8) - s.l) * 0.18; s.r += ((hi / 12) * 1.25 - s.r) * 0.18;
    const mw = Math.min(w / 2.3, h * 1.3), mh = mw * 0.62;
    [[s.l, 'LOW'], [s.r, 'HIGH']].forEach(([v, label], k) => {
      const x = w / 2 + (k ? 0.08 : -1.08) * mw, y = h / 2 - mh / 2;
      const face = ctx.createLinearGradient(0, y, 0, y + mh);
      face.addColorStop(0, '#f3e6c4'); face.addColorStop(1, '#d9c597');
      ctx.fillStyle = '#2a2420'; ctx.fillRect(x - 6, y - 6, mw + 12, mh + 12);
      ctx.fillStyle = face; ctx.fillRect(x, y, mw, mh);
      const px = x + mw / 2, py = y + mh * 0.92, R = mh * 0.78;
      ctx.lineWidth = 2; ctx.strokeStyle = '#3b3128';
      ctx.beginPath(); ctx.arc(px, py, R, Math.PI * 1.22, Math.PI * 1.78); ctx.stroke();
      ctx.strokeStyle = '#c4302b'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(px, py, R, Math.PI * 1.64, Math.PI * 1.78); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#3b3128';
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * (1.22 + 0.56 * (i / 10));
        ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * R, py + Math.sin(a) * R); ctx.lineTo(px + Math.cos(a) * (R - (i % 5 ? 6 : 12)), py + Math.sin(a) * (R - (i % 5 ? 6 : 12))); ctx.stroke();
      }
      ctx.fillStyle = '#3b3128'; ctx.font = `700 ${Math.max(8, mh * 0.1)}px system-ui`; ctx.textAlign = 'center';
      ctx.fillText('VU', px, y + mh * 0.6); ctx.font = `600 ${Math.max(7, mh * 0.07)}px system-ui`; ctx.fillText(label as string, px, y + mh * 0.75);
      const a = Math.PI * (1.22 + 0.56 * Math.min(1, (v as number) * 1.15));
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * R * 1.02, py + Math.sin(a) * R * 1.02); ctx.stroke();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(px, py, 5, 0, TAU); ctx.fill();
    });
  }
};

const HEAT: [number, number, number][] = [[0, 0, 4], [20, 10, 80], [110, 20, 140], [220, 60, 70], [255, 160, 20], [255, 240, 140], [255, 255, 255]];
function heat(v: number): [number, number, number] {
  const x = Math.max(0, Math.min(0.999, v)) * (HEAT.length - 1), i = Math.floor(x), k = x - i;
  const a = HEAT[i]!, b = HEAT[i + 1]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

type FallState = { buf: HTMLCanvasElement; bctx: CanvasRenderingContext2D | null; img: ImageData | null; W: number; H: number };
const waterfall: Scene = {
  id: 'waterfall', name: 'Spectrogram',
  setup: f => {
    const W = small(f) ? 96 : 320, H = small(f) ? 48 : 128;
    const buf = document.createElement('canvas'); buf.width = W; buf.height = H;
    const bctx = buf.getContext('2d');
    const img = bctx?.createImageData(W, H) ?? null;
    if (img) for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255; // start black, not transparent
    return { buf, bctx, img, W, H };
  },
  draw: (f, s: FallState) => {
    if (!s.bctx || !s.img) return;
    const d = s.img.data, { W, H } = s;
    // Scroll left one column, then paint the newest moment on the right (low notes at the bottom).
    d.copyWithin(0, 4);
    for (let y = 0; y < H; y++) {
      const v = f.band(H - 1 - y, H);
      const o = (y * W + W - 1) * 4;
      // A heat map: black, deep blue, purple, orange, yellow, white.
      const [r, g, b] = heat(v);
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    s.bctx.putImageData(s.img, 0, 0);
    f.ctx.imageSmoothingEnabled = true;
    f.ctx.drawImage(s.buf, 0, 0, f.w, f.h);
  }
};

// ---------- Waves and lines ----------

const mist: Scene = { gl: mistGl, id: 'mist', name: 'Ocean mist' };

const waves: Scene = {
  id: 'waves', name: 'Waves',
  draw: f => {
    const { ctx, w, h, hue, t } = f;
    fade(f, 'rgba(3,5,12,0.28)');
    const lines = small(f) ? 4 : 7;
    ctx.globalCompositeOperation = 'lighter';
    for (let l = 0; l < lines; l++) {
      const v = f.band(3 + l * 5, 40);
      ctx.beginPath();
      for (let x = 0; x <= w; x += Math.max(2, w / 300)) {
        const p = x / w;
        const env = Math.sin(p * Math.PI); // fixed ends, like a string
        const y = h / 2 + Math.sin(p * (4 + l) * Math.PI + t * 0.03 * (l % 2 ? 1 : -1) + l) * env * h * (0.04 + v * 0.36);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsla(${(hue + l * 40) % 360},90%,62%,0.75)`;
      ctx.lineWidth = small(f) ? 1 : 2 + v * 3; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = glow(f, 12); ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'source-over';
  }
};

const aurora: Scene = { gl: auroraGl, id: 'aurora', name: 'Aurora' };

const scope: Scene = {
  id: 'scope', name: 'Scope',
  draw: f => {
    const { ctx, w, h, hue, wave } = f;
    fade(f, 'rgba(0,6,4,0.3)');
    // A faint graticule, like a bench oscilloscope.
    ctx.strokeStyle = 'rgba(80,255,180,0.06)'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo((w / 10) * i, 0); ctx.lineTo((w / 10) * i, h); ctx.stroke(); }
    for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, (h / 6) * i); ctx.lineTo(w, (h / 6) * i); ctx.stroke(); }
    ctx.beginPath();
    for (let i = 0; i < wave.length; i += 4) {
      const x = (i / wave.length) * w, y = h / 2 + ((wave[i]! - 128) / 128) * h * 0.45;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `hsl(${(hue + 120) % 360},95%,60%)`; ctx.lineWidth = small(f) ? 1.5 : 2.5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = glow(f, 14); ctx.stroke(); ctx.shadowBlur = 0;
  }
};

const lissajous: Scene = {
  id: 'lissajous', name: 'Lissajous',
  draw: f => {
    const { ctx, w, h, hue, wave, t } = f;
    fade(f, 'rgba(2,3,8,0.1)');
    const R = Math.min(w, h) * 0.42, lag = 96;
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(t * 0.003);
    ctx.beginPath();
    // One moment of the waveform against itself a little later: the figures of an X-Y oscilloscope.
    // Averaged over a few samples, so the line draws curves instead of jitter.
    const at = (i: number) => (wave[i - 2]! + wave[i - 1]! + wave[i]! + wave[i + 1]! + wave[i + 2]! - 640) / 640;
    for (let i = 2; i + lag + 2 < wave.length; i += 3) {
      const x = at(i) * R * 1.8, y = at(i + lag) * R * 1.8;
      if (i === 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `hsla(${hue % 360},95%,65%,0.45)`; ctx.lineWidth = small(f) ? 1 : 1.3;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = glow(f, 16); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.restore();
  }
};

type TerrainState = { rows: Float32Array[]; tick: number };
const terrain: Scene = {
  id: 'terrain', name: 'Synthwave',
  setup: () => ({ rows: Array.from({ length: 26 }, () => new Float32Array(33)), tick: 0 }),
  draw: (f, s: TerrainState) => {
    const { ctx, w, h, bass } = f;
    const horizon = h * 0.46;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#0b0420'); sky.addColorStop(1, '#3a0a4a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, horizon);
    ctx.fillStyle = '#05010c'; ctx.fillRect(0, horizon, w, h - horizon);
    // The sun, striped, swelling with the bass.
    const sr = Math.min(w, h) * (0.17 + bass * 0.04), sx = w / 2, sy = horizon - sr * 0.35;
    ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.clip();
    const sun = ctx.createLinearGradient(0, sy - sr, 0, sy + sr); sun.addColorStop(0, '#ffd34d'); sun.addColorStop(1, '#ff2d95');
    ctx.fillStyle = sun; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    ctx.fillStyle = '#3a0a4a';
    for (let i = 0; i < 7; i++) { const y = sy + sr * (0.1 + i * 0.13); ctx.fillRect(sx - sr, y, sr * 2, 1.5 + i * 1.3); }
    ctx.restore();
    // New spectrum row at the far end every few frames; the land rolls toward you.
    s.tick += f.step;
    if (every({ t: s.tick, step: f.step }, 3)) {
      const row = s.rows.pop()!;
      for (let c = 0; c < row.length; c++) { const mid = Math.abs(c - 16) / 16; row[c] = f.band(Math.floor(mid * 30), 32) * (0.35 + mid); }
      s.rows.unshift(row);
    }
    const project = (r: number, c: number) => {
      const z = (r + 1 - (s.tick % 3) / 3) / s.rows.length; // 0 far .. 1 near
      const p = Math.pow(z, 1.7);
      const x = w / 2 + (c - 16) / 16 * w * (0.12 + p * 1.1);
      const y = horizon + p * (h - horizon) - s.rows[r]![c]! * h * 0.18 * (0.3 + p);
      return [x, y] as const;
    };
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(0,240,255,0.75)'; ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = glow(f, 6);
    for (let r = 0; r < s.rows.length; r++) {
      ctx.beginPath();
      for (let c = 0; c < 33; c++) { const [x, y] = project(r, c); if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,45,149,0.55)'; ctx.shadowColor = '#ff2d95';
    for (let c = 0; c < 33; c += 2) {
      ctx.beginPath();
      for (let r = 0; r < s.rows.length; r++) { const [x, y] = project(r, c); if (r === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
};

// ---------- Particles and space ----------

type AlchemySpark = { a: number; r: number; v: number; s: number };
type AlchemyState = { sparks: AlchemySpark[]; halo: HTMLCanvasElement };
/** A soft white light, drawn once and stamped (tinted by 'lighter' over colour) for each spark's halo. */
function haloSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!; const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.18, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return c;
}
const alchemy: Scene = {
  id: 'alchemy', name: 'Alchemy',
  setup: f => ({ sparks: Array.from({ length: small(f) ? 40 : 160 }, () => ({ a: Math.random() * TAU, r: Math.random(), v: 0.002 + Math.random() * 0.006, s: 0.5 + Math.random() })), halo: haloSprite() }),
  draw: (f, st: AlchemyState) => {
    const { ctx, w, h, hue, bass } = f;
    // A short afterglow only: sparks stay sharp instead of smearing.
    fade(f, 'rgba(0,0,0,0.45)');
    const R = Math.min(w, h) * 0.5, unit = Math.min(w, h) / 1000;
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.globalCompositeOperation = 'lighter';
    const arms = 8;
    // One colour pass per band of the swirl (8 fills), each spark a crisp dot plus a stamped halo.
    const groups: Path2D[] = Array.from({ length: 8 }, () => new Path2D());
    for (const p of st.sparks) {
      p.a += (p.v * (1 + bass * 4)) * f.step; p.r += (0.0015 + bass * 0.012) * f.step; if (p.r > 1) p.r = Math.random() * 0.15;
      const size = unit * (2 + p.s * 3) * (1 + bass * 1.5) * (1 - p.r * 0.5);
      const g = groups[Math.min(7, Math.floor(p.r * 8))]!;
      for (let k = 0; k < arms; k++) {
        const a = p.a + (k * TAU) / arms, rr = p.r * R;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr * (k % 2 ? 1 : -1);
        g.moveTo(x + size, y); g.arc(x, y, size, 0, TAU);
        if (!small(f)) { ctx.globalAlpha = 0.9 * p.r * (1 - p.r); ctx.drawImage(st.halo, x - size * 4, y - size * 4, size * 8, size * 8); }
      }
    }
    ctx.globalAlpha = 1;
    groups.forEach((g, i) => { ctx.fillStyle = `hsla(${(hue + i * 20) % 360},95%,${58 + i * 2}%,${0.35 + i * 0.07})`; ctx.fill(g); });
    ctx.restore(); ctx.globalCompositeOperation = 'source-over';
  }
};

const plenoptic: Scene = {
  id: 'plenoptic', name: 'Plenoptic',
  draw: f => {
    const { ctx, w, h, hue, bass, t } = f;
    fade(f, 'rgba(2,2,6,0.3)');
    const n = small(f) ? 220 : 900, golden = Math.PI * (3 - Math.sqrt(5));
    const scale = Math.min(w, h) * 0.5 / Math.sqrt(n) * (1 + bass * 0.25);
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.globalCompositeOperation = 'lighter';
    // Seeds in a sunflower pattern; each ring of seeds follows one band of the music.
    for (let k = 0; k < n; k++) {
      const a = k * golden + t * 0.004, r = Math.sqrt(k) * scale;
      const v = f.band(Math.floor((k / n) * 48), 48);
      ctx.fillStyle = `hsla(${(hue + k * 0.4) % 360},90%,${45 + v * 35}%,${0.35 + v * 0.6})`;
      ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, (small(f) ? 0.8 : 1.4) + v * (small(f) ? 1.5 : 4), 0, TAU); ctx.fill();
    }
    ctx.restore(); ctx.globalCompositeOperation = 'source-over';
  }
};

type Star = { x: number; y: number; z: number };
const starfield: Scene = {
  id: 'starfield', name: 'Starfield',
  setup: f => Array.from({ length: small(f) ? 60 : 360 }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() })),
  draw: (f, stars: Star[]) => {
    const { ctx, w, h, hue, bass, mids, tint: [tr, tg, tb] } = f;
    fade(f, `rgba(0,0,6,${0.35 - bass * 0.2})`);
    const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * (0.25 + bass * 0.2));
    glow.addColorStop(0, `rgba(${tr},${tg},${tb},${0.12 + bass * 0.25})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    const speed = 0.004 + bass * 0.04 + mids * 0.01;
    for (const st of stars) {
      const pz = st.z; st.z -= (speed) * f.step;
      if (st.z <= 0.02) { st.x = (Math.random() - 0.5) * 2; st.y = (Math.random() - 0.5) * 2; st.z = 1; continue; }
      const sx = w / 2 + (st.x / st.z) * w * 0.5, sy = h / 2 + (st.y / st.z) * h * 0.5;
      const px = w / 2 + (st.x / pz) * w * 0.5, py = h / 2 + (st.y / pz) * h * 0.5;
      if (sx < 0 || sx > w || sy < 0 || sy > h) { st.z = 1; continue; }
      ctx.strokeStyle = `hsla(${(hue + st.z * 120) % 360},80%,${70 + (1 - st.z) * 30}%,${1 - st.z})`;
      ctx.lineWidth = (1 - st.z) * (small(f) ? 1.5 : 3);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
    }
  }
};

type GalaxyStar = { arm: number; r: number; off: number; s: number };
const galaxy: Scene = {
  id: 'galaxy', name: 'Galaxy',
  setup: f => Array.from({ length: small(f) ? 160 : 900 }, () => ({ arm: Math.floor(Math.random() * 3), r: Math.pow(Math.random(), 0.7), off: (Math.random() - 0.5) * 0.5, s: Math.random() })),
  draw: (f, stars: GalaxyStar[]) => {
    const { ctx, w, h, hue, bass, mids, t, tint: [tr, tg, tb] } = f;
    fade(f, 'rgba(1,1,5,0.35)');
    const R = Math.max(w, h) * 0.5, cx = w / 2, cy = h / 2;
    const spin = t * (0.002 + mids * 0.004);
    ctx.save(); ctx.translate(cx, cy); ctx.scale(1, 0.62); ctx.globalCompositeOperation = 'lighter';
    for (const st of stars) {
      const a = st.arm * (TAU / 3) + st.r * 5.2 + st.off - spin * (1.2 - st.r * 0.6);
      const v = f.band(Math.floor(st.r * 40), 40);
      const rr = st.r * R;
      ctx.fillStyle = `hsla(${(hue + 200 + st.r * 120) % 360},80%,${55 + v * 35}%,${0.25 + v * 0.7})`;
      ctx.fillRect(Math.cos(a) * rr, Math.sin(a) * rr, 1 + st.s * (small(f) ? 1 : 2) + v * 2, 1 + st.s * (small(f) ? 1 : 2) + v * 2);
    }
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * (0.2 + bass * 0.15));
    core.addColorStop(0, `rgba(255,240,220,${0.6 + bass * 0.4})`); core.addColorStop(0.4, `rgba(${tr},${tg},${tb},0.35)`); core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, R * 0.4, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalCompositeOperation = 'source-over';
  }
};

type Drop = { x: number; y: number; vx: number; vy: number; life: number; hue: number };
const fountain: Scene = {
  id: 'fountain', name: 'Fountain',
  setup: () => [] as Drop[],
  draw: (f, drops: Drop[]) => {
    const { ctx, w, h, hue, bass, beat, level } = f;
    fade(f, 'rgba(2,3,10,0.22)');
    const spawn = (small(f) ? 2 : 8) + Math.floor(level * (small(f) ? 6 : 26)) + (beat ? (small(f) ? 20 : 120) : 0);
    for (let i = 0; i < spawn && drops.length < (small(f) ? 300 : 1800); i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * (0.5 + bass * 0.8);
      const sp = h * (0.012 + Math.random() * 0.012 + bass * 0.018);
      drops.push({ x: w / 2 + (Math.random() - 0.5) * w * 0.04, y: h, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: (hue + Math.random() * 60) % 360 });
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]!;
      d.x += (d.vx) * f.step; d.y += (d.vy) * f.step; d.vy += (h * 0.00045) * f.step; d.life -= (0.008) * f.step;
      if (d.life <= 0 || d.y > h + 4) { drops.splice(i, 1); continue; }
      ctx.fillStyle = `hsla(${d.hue},90%,65%,${d.life})`;
      ctx.fillRect(d.x, d.y, small(f) ? 1.5 : 3.5, small(f) ? 1.5 : 3.5);
    }
    const base = ctx.createRadialGradient(w / 2, h, 0, w / 2, h, h * (0.25 + bass * 0.3));
    base.addColorStop(0, `hsla(${hue},90%,65%,${0.25 + bass * 0.4})`); base.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
};

type Bubble = { x: number; y: number; r: number; v: number; hue: number };
const bubbles: Scene = {
  id: 'bubbles', name: 'Bubbles',
  setup: () => [] as Bubble[],
  draw: (f, list: Bubble[]) => {
    const { ctx, w, h, hue, beat, level, t } = f;
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#02121c'); bg.addColorStop(1, '#03263a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if ((beat || Math.random() < level * 0.5) && list.length < (small(f) ? 25 : 120)) {
      const v = f.band(Math.floor(Math.random() * 24), 24);
      list.push({ x: Math.random() * w, y: h + 20, r: (small(f) ? 3 : 8) + v * (small(f) ? 10 : 40), v: 0.6 + Math.random() * 1.6, hue: (hue + Math.random() * 80) % 360 });
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]!;
      b.y -= (b.v * (1 + level * 2)) * f.step; b.x += (Math.sin(t * 0.03 + b.r) * 0.6) * f.step;
      if (b.y < -b.r * 2) { list.splice(i, 1); continue; }
      const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, `hsla(${b.hue},80%,60%,0.12)`); g.addColorStop(1, `hsla(${b.hue},90%,70%,0.45)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    }
  }
};

// ---------- Geometry and light ----------

const tunnel: Scene = { gl: tunnelGl, id: 'tunnel', name: 'Tunnel' };

type RippleState = { rings: { r: number; hue: number }[] };
const ripples: Scene = {
  id: 'ripples', name: 'Ripples',
  setup: () => ({ rings: [] }),
  draw: (f, s: RippleState) => {
    const { ctx, w, h, hue, bass, beat, tint: [tr, tg, tb] } = f;
    fade(f, 'rgba(2,4,10,0.2)');
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
    bg.addColorStop(0, `rgba(${tr},${tg},${tb},${0.06 + bass * 0.12})`); bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (beat || every(f, 36)) s.rings.push({ r: Math.min(w, h) * 0.05, hue });
    const max = Math.hypot(w, h) / 2;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = s.rings.length - 1; i >= 0; i--) {
      const rp = s.rings[i]!;
      rp.r += (max * 0.008 * (1 + bass * 1.5)) * f.step;
      const life = 1 - rp.r / max;
      if (life <= 0) { s.rings.splice(i, 1); continue; }
      // Each ring is shaped by the music as it travels out.
      ctx.beginPath();
      const pts = small(f) ? 48 : 120;
      for (let k = 0; k < pts; k++) {
        const a = (k / pts) * TAU, r = rp.r + f.ring(k, pts) * Math.min(w, h) * 0.05 * life;
        const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `hsla(${rp.hue},90%,65%,${life * 0.9})`; ctx.lineWidth = 1 + life * (small(f) ? 2 : 5); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    const core = Math.min(w, h) * (0.04 + bass * 0.07);
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, core);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, `hsla(${hue},90%,60%,0.2)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2, h / 2, core, 0, TAU); ctx.fill();
  }
};

const kaleidoscope: Scene = { gl: kaleidoGl, id: 'kaleidoscope', name: 'Kaleidoscope' };

type BatteryState = { buf: HTMLCanvasElement; bctx: CanvasRenderingContext2D | null; sides: number };
const battery: Scene = {
  id: 'battery', name: 'Battery',
  setup: () => { const buf = document.createElement('canvas'); return { buf, bctx: buf.getContext('2d'), sides: 5 }; },
  draw: (f, s: BatteryState) => {
    const { ctx, w, h, hue, bass, beat, t, dpr } = f;
    if (!s.bctx) return;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    if (s.buf.width !== cw || s.buf.height !== ch) { s.buf.width = cw; s.buf.height = ch; }
    // Feedback: the last frame, slightly bigger and turned, under the new one. That is the endless-zoom look.
    s.bctx.clearRect(0, 0, cw, ch); s.bctx.drawImage(ctx.canvas, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, cw, ch);
    ctx.translate(cw / 2, ch / 2); ctx.rotate(0.012 + bass * 0.02); ctx.scale(1.035 + bass * 0.03, 1.035 + bass * 0.03); ctx.translate(-cw / 2, -ch / 2);
    ctx.globalAlpha = 0.9; ctx.drawImage(s.buf, 0, 0); ctx.globalAlpha = 1;
    ctx.restore(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (beat) s.sides = 3 + Math.floor(Math.random() * 5);
    const R = Math.min(w, h) * (0.08 + bass * 0.12);
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-t * 0.02);
    ctx.beginPath();
    for (let i = 0; i <= s.sides; i++) { const a = (i / s.sides) * TAU; if (i === 0) ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); else ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
    ctx.strokeStyle = `hsl(${hue % 360},100%,65%)`; ctx.lineWidth = small(f) ? 1.5 : 3; ctx.stroke();
    ctx.restore();
  }
};

type Bolt = { pts: [number, number][]; life: number; hue: number };
type Storm = { bolts: Bolt[]; flash: number; clouds: { x: number; y: number; r: number; v: number }[] };
const lightning: Scene = {
  id: 'lightning', name: 'Lightning',
  setup: f => ({ bolts: [], flash: 0, clouds: Array.from({ length: small(f) ? 6 : 14 }, () => ({ x: Math.random(), y: Math.random() * 0.45, r: 0.15 + Math.random() * 0.25, v: 0.0003 + Math.random() * 0.0006 })) }),
  draw: (f, storm: Storm) => {
    const { ctx, w, h, hue, bass, beat, level } = f;
    const bolts = storm.bolts;
    fade(f, 'rgba(4,4,14,0.35)');
    // Clouds drift across, lit from inside when lightning strikes.
    storm.flash *= Math.pow(0.85, f.step);
    for (const c of storm.clouds) {
      c.x += (c.v) * f.step; if (c.x - c.r > 1.2) c.x = -c.r;
      const g = ctx.createRadialGradient(c.x * w, c.y * h, 0, c.x * w, c.y * h, c.r * w);
      g.addColorStop(0, `hsla(${(hue + 230) % 360},45%,${30 + storm.flash * 50}%,${0.5 + storm.flash * 0.4})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(c.x * w - c.r * w, c.y * h - c.r * w, c.r * w * 2, c.r * w * 2);
    }
    if (beat || every(f, 45) || Math.random() < level * 0.05 * f.step) {
      storm.flash = Math.min(1, storm.flash + (beat ? 0.9 : 0.5));
      // A jagged path from the top to somewhere below, by repeatedly nudging midpoints.
      let pts: [number, number][] = [[w * (0.2 + Math.random() * 0.6), 0], [w * (0.15 + Math.random() * 0.7), h * (0.6 + Math.random() * 0.4)]];
      for (let k = 0; k < 6; k++) {
        const next: [number, number][] = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!;
          next.push([x0, y0], [(x0 + x1) / 2 + (Math.random() - 0.5) * w * 0.12 / (k + 1), (y0 + y1) / 2]);
        }
        next.push(pts[pts.length - 1]!); pts = next;
      }
      bolts.push({ pts, life: 1, hue: (hue + 200) % 360 });
    }
    if (storm.flash > 0.05) { ctx.fillStyle = `rgba(200,210,255,${storm.flash * 0.12})`; ctx.fillRect(0, 0, w, h); }
    const horizon = ctx.createLinearGradient(0, h * 0.7, 0, h);
    horizon.addColorStop(0, 'rgba(0,0,0,0)'); horizon.addColorStop(1, `hsla(${(hue + 220) % 360},80%,40%,${0.1 + bass * 0.3})`);
    ctx.fillStyle = horizon; ctx.fillRect(0, h * 0.7, w, h * 0.3);
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]!;
      b.life -= (0.035) * f.step;
      if (b.life <= 0) { bolts.splice(i, 1); continue; }
      ctx.beginPath(); b.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = `hsla(${b.hue},100%,85%,${b.life})`; ctx.lineWidth = (small(f) ? 1 : 2.5) * b.life + 0.5;
      ctx.shadowColor = `hsl(${b.hue},100%,70%)`; ctx.shadowBlur = glow(f, 24); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
};

const colors: Scene = { gl: colorsGl, id: 'colors', name: 'Musical colors' };

type MatrixState = { drops: number[]; size: number };
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789';
const matrix: Scene = {
  id: 'matrix', name: 'Code rain',
  setup: f => { const size = small(f) ? 8 : 16; return { size, drops: Array.from({ length: Math.ceil(f.w / size) + 1 }, () => Math.random() * -50) }; },
  draw: (f, s: MatrixState) => {
    const { ctx, w, h, level, tint: [tr, , tb] } = f;
    fade(f, 'rgba(0,0,0,0.12)');
    ctx.font = `${s.size}px monospace`;
    const cols = Math.ceil(w / s.size);
    while (s.drops.length < cols) s.drops.push(Math.random() * -50);
    for (let i = 0; i < cols; i++) {
      const v = f.band(Math.floor((i / cols) * 32), 32);
      const y = s.drops[i]! * s.size;
      ctx.fillStyle = `rgba(${Math.min(255, tr * 0.4 + 200 * v)},255,${Math.min(255, tb * 0.4 + 120 * v)},${0.5 + v * 0.5})`;
      ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!, i * s.size, y);
      s.drops[i]! += (0.35 + level * 1.4 + v * 0.8) * f.step;
      if (y > h && Math.random() > 0.96) s.drops[i] = 0;
    }
  }
};

// ---------- Pixel fields ----------

const plasma: Scene = { gl: plasmaGl, id: 'plasma', name: 'Plasma' };

const fire: Scene = { gl: fireGl, id: 'fire', name: 'Fire' };

// ---------- Feelings: picked by "By mood" from what a song is about ----------

type Bokeh = { x: number; y: number; r: number; hue: number; a: number };
const bokeh = (n: number, hues: [number, number]): Bokeh[] => Array.from({ length: n }, () => ({ x: Math.random(), y: Math.random() * 0.8, r: 0.02 + Math.random() * 0.06, hue: hues[0] + Math.random() * (hues[1] - hues[0]), a: 0.08 + Math.random() * 0.2 }));
function drawBokeh(f: Frame, list: Bokeh[], boost: number) {
  const { ctx, w, h } = f;
  for (const b of list) {
    const r = b.r * Math.min(w, h) * 2;
    const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, r);
    g.addColorStop(0, `hsla(${b.hue},80%,60%,${b.a * (1 + boost)})`); g.addColorStop(0.7, `hsla(${b.hue},80%,55%,${b.a * 0.5})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(b.x * w - r, b.y * h - r, r * 2, r * 2);
  }
}

type RainState = { lights: Bokeh[]; streaks: { x: number; y: number; len: number; v: number }[]; drops: { x: number; y: number; r: number; v: number }[] };
const rain: Scene = {
  id: 'rain', name: 'Rain',
  setup: f => ({
    lights: bokeh(small(f) ? 6 : 22, [190, 260]),
    streaks: Array.from({ length: small(f) ? 40 : 260 }, () => ({ x: Math.random(), y: Math.random(), len: 0.03 + Math.random() * 0.07, v: 0.012 + Math.random() * 0.02 })),
    drops: Array.from({ length: small(f) ? 8 : 40 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 4, v: 0 }))
  }),
  draw: (f, s: RainState) => {
    const { ctx, w, h, level, bass } = f;
    // A rainy night seen through a window: blurred city lights, falling rain, drops running down the glass.
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#060b16'); bg.addColorStop(1, '#0d1726');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    drawBokeh(f, s.lights, bass * 0.8);
    ctx.strokeStyle = 'rgba(180,205,255,0.5)'; ctx.lineWidth = small(f) ? 0.7 : 1.3;
    ctx.beginPath();
    for (const st of s.streaks) {
      st.y += (st.v * (0.8 + level * 1.5)) * f.step; st.x -= (st.v * 0.12) * f.step;
      if (st.y > 1.1) { st.y = -0.1; st.x = Math.random() * 1.1; }
      ctx.moveTo(st.x * w, st.y * h); ctx.lineTo((st.x - st.len * 0.12) * w, (st.y + st.len) * h);
    }
    ctx.stroke();
    for (const d of s.drops) {
      // Drops cling, then slide when they grow heavy, leaving a short trail.
      if (d.v === 0 && Math.random() < 0.004 + level * 0.01) d.v = 0.002 + Math.random() * 0.004;
      d.y += (d.v) * f.step; if (d.v) d.v *= 1.01;
      if (d.y > 1.05) { d.y = Math.random() * 0.5; d.x = Math.random(); d.v = 0; d.r = 1 + Math.random() * 4; }
      const x = d.x * w, y = d.y * h, r = d.r * (small(f) ? 0.5 : 1);
      if (d.v) { ctx.strokeStyle = 'rgba(200,220,255,0.12)'; ctx.lineWidth = r * 0.8; ctx.beginPath(); ctx.moveTo(x, y - r * 8); ctx.lineTo(x, y); ctx.stroke(); }
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(150,180,230,0.15)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }
};

type SnowState = { flakes: { x: number; y: number; r: number; z: number; p: number }[] };
const snow: Scene = {
  id: 'snow', name: 'Snow',
  setup: f => ({ flakes: Array.from({ length: small(f) ? 60 : 380 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random(), z: 0.3 + Math.random() * 0.7, p: Math.random() * TAU })) }),
  draw: (f, s: SnowState) => {
    const { ctx, w, h, level, t, tint: [tr, tg, tb] } = f;
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#0a1020'); bg.addColorStop(1, `rgb(${18 + tr * 0.08},${24 + tg * 0.08},${40 + tb * 0.1})`);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const moon = ctx.createRadialGradient(w * 0.78, h * 0.2, 0, w * 0.78, h * 0.2, Math.min(w, h) * 0.3);
    moon.addColorStop(0, 'rgba(230,240,255,0.35)'); moon.addColorStop(0.15, 'rgba(230,240,255,0.18)'); moon.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = moon; ctx.fillRect(0, 0, w, h);
    for (const fl of s.flakes) {
      fl.y += (0.0008 * fl.z * (1 + level * 2)) * f.step; fl.x += (Math.sin(t * 0.01 + fl.p) * 0.0004 * fl.z) * f.step;
      if (fl.y > 1.02) { fl.y = -0.02; fl.x = Math.random(); }
      const v = f.band(Math.floor(fl.r * 30), 30);
      ctx.fillStyle = `rgba(255,255,255,${0.35 + fl.z * 0.45 + v * 0.2})`;
      ctx.beginPath(); ctx.arc(fl.x * w, fl.y * h, (small(f) ? 0.6 : 1.2) + fl.z * (small(f) ? 1 : 2.4) + v * 1.5, 0, TAU); ctx.fill();
    }
  }
};

type PetalState = { petals: { x: number; y: number; a: number; spin: number; s: number; v: number; sway: number }[]; hearts: { x: number; y: number; life: number; s: number }[]; glow: Bokeh[] };
const petals: Scene = {
  id: 'petals', name: 'Rose petals',
  setup: f => ({
    petals: Array.from({ length: small(f) ? 18 : 90 }, () => ({ x: Math.random(), y: Math.random(), a: Math.random() * TAU, spin: (Math.random() - 0.5) * 0.04, s: 0.6 + Math.random() * 0.8, v: 0.0012 + Math.random() * 0.0018, sway: Math.random() * TAU })),
    hearts: [], glow: bokeh(small(f) ? 5 : 16, [330, 380])
  }),
  draw: (f, s: PetalState) => {
    const { ctx, w, h, bass, beat, t, level } = f;
    // Warm candlelight, rose petals drifting down, a heart rising now and then on the beat.
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#1a0610'); bg.addColorStop(1, '#3a0d1e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    drawBokeh(f, s.glow, bass * 0.6);
    const size = Math.min(w, h) * (small(f) ? 0.035 : 0.022);
    for (const p of s.petals) {
      p.y += (p.v * (1 + level)) * f.step; p.x += (Math.sin(t * 0.012 + p.sway) * 0.0009) * f.step; p.a += (p.spin) * f.step;
      if (p.y > 1.05) { p.y = -0.05; p.x = Math.random(); }
      ctx.save(); ctx.translate(p.x * w, p.y * h); ctx.rotate(p.a); ctx.scale(1, 0.55 + Math.sin(t * 0.03 + p.sway) * 0.35);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * p.s);
      g.addColorStop(0, 'rgba(255,120,150,0.95)'); g.addColorStop(1, 'rgba(170,20,60,0.85)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, -size * p.s); ctx.quadraticCurveTo(size * p.s, 0, 0, size * p.s); ctx.quadraticCurveTo(-size * p.s, 0, 0, -size * p.s); ctx.fill();
      ctx.restore();
    }
    if (beat && s.hearts.length < 6) s.hearts.push({ x: 0.2 + Math.random() * 0.6, y: 1, life: 1, s: 0.6 + Math.random() * 0.8 });
    for (let i = s.hearts.length - 1; i >= 0; i--) {
      const hh = s.hearts[i]!;
      hh.y -= (0.004) * f.step; hh.life -= (0.006) * f.step;
      if (hh.life <= 0) { s.hearts.splice(i, 1); continue; }
      const r = Math.min(w, h) * 0.03 * hh.s;
      ctx.save(); ctx.translate(hh.x * w, hh.y * h); ctx.fillStyle = `rgba(255,90,130,${hh.life * 0.6})`;
      ctx.shadowColor = 'rgba(255,90,130,0.8)'; ctx.shadowBlur = glow(f, 20);
      ctx.beginPath(); ctx.moveTo(0, r * 0.9);
      ctx.bezierCurveTo(-r * 1.6, -r * 0.2, -r * 0.6, -r * 1.4, 0, -r * 0.5);
      ctx.bezierCurveTo(r * 0.6, -r * 1.4, r * 1.6, -r * 0.2, 0, r * 0.9); ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
  }
};

type SunState = { motes: { x: number; y: number; v: number; s: number }[] };
const sunrise: Scene = {
  id: 'sunrise', name: 'Sunrise',
  setup: f => ({ motes: Array.from({ length: small(f) ? 30 : 160 }, () => ({ x: Math.random(), y: Math.random(), v: 0.0006 + Math.random() * 0.0016, s: Math.random() })) }),
  draw: (f, s: SunState) => {
    const { ctx, w, h, bass, level, t } = f;
    // Dawn: the sky warms from the horizon, rays turn slowly and reach further with the music, light floats up.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1b2a5a'); sky.addColorStop(0.5, '#d9677a'); sky.addColorStop(0.8, '#ffb15c'); sky.addColorStop(1, '#ffe2a0');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    const sx = w / 2, sy = h * (0.78 - level * 0.06), sr = Math.min(w, h) * (0.12 + bass * 0.04);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * 0.0015); ctx.globalCompositeOperation = 'lighter';
    const rays = small(f) ? 12 : 24;
    for (let i = 0; i < rays; i++) {
      const v = f.ring(i, rays), a = (i / rays) * TAU, len = Math.max(w, h) * (0.5 + v * 0.6);
      ctx.fillStyle = `rgba(255,230,170,${0.04 + v * 0.1})`;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a - 0.05) * len, Math.sin(a - 0.05) * len); ctx.lineTo(Math.cos(a + 0.05) * len, Math.sin(a + 0.05) * len); ctx.fill();
    }
    ctx.restore(); ctx.globalCompositeOperation = 'source-over';
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.2);
    sun.addColorStop(0, 'rgba(255,255,235,1)'); sun.addColorStop(0.35, 'rgba(255,220,140,0.95)'); sun.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(sx, sy, sr * 2.2, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(40,20,45,0.85)'; // hills
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, h * 0.86 - Math.sin(x / w * 5 + 1) * h * 0.04 - Math.sin(x / w * 13) * h * 0.012);
    ctx.lineTo(w, h); ctx.fill();
    for (const m of s.motes) {
      m.y -= (m.v * (1 + level * 2)) * f.step; if (m.y < -0.02) { m.y = 1; m.x = Math.random(); }
      ctx.fillStyle = `rgba(255,240,200,${0.25 + m.s * 0.5})`;
      ctx.beginPath(); ctx.arc(m.x * w + Math.sin(t * 0.01 + m.s * 9) * 8, m.y * h, (small(f) ? 0.6 : 1.2) + m.s * 1.8, 0, TAU); ctx.fill();
    }
  }
};

type Spark = { x: number; y: number; vx: number; vy: number; life: number; hue: number };
type Show = { rockets: { x: number; y: number; vy: number; hue: number; at: number }[]; sparks: Spark[] };
const fireworks: Scene = {
  id: 'fireworks', name: 'Fireworks',
  setup: () => ({ rockets: [], sparks: [] }),
  draw: (f, s: Show) => {
    const { ctx, w, h, beat, level } = f;
    fade(f, 'rgba(3,3,12,0.22)');
    // A rocket goes up on each beat (and now and then anyway) and bursts at the top of its climb.
    if ((beat || every(f, 50)) && s.rockets.length < 6) s.rockets.push({ x: w * (0.15 + Math.random() * 0.7), y: h, vy: -h * (0.016 + Math.random() * 0.006), hue: Math.random() * 360, at: h * (0.15 + Math.random() * 0.35) });
    for (let i = s.rockets.length - 1; i >= 0; i--) {
      const r = s.rockets[i]!;
      r.y += (r.vy) * f.step; r.vy *= Math.pow(0.985, f.step);
      ctx.fillStyle = `hsla(${r.hue},100%,80%,0.9)`; ctx.fillRect(r.x, r.y, 2, 6);
      if (r.y <= r.at || r.vy > -1) {
        const n = (small(f) ? 30 : 110) + Math.floor(level * 80);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU, sp = (small(f) ? 1.2 : 2.4) + Math.random() * (small(f) ? 1.5 : 3.5);
          s.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: (r.hue + Math.random() * 40) % 360 });
        }
        s.rockets.splice(i, 1);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = s.sparks.length - 1; i >= 0; i--) {
      const p = s.sparks[i]!;
      p.x += (p.vx) * f.step; p.y += (p.vy) * f.step; p.vy += (0.045) * f.step; p.vx *= Math.pow(0.985, f.step); p.vy *= Math.pow(0.985, f.step); p.life -= (0.008) * f.step;
      if (p.life <= 0) { s.sparks.splice(i, 1); continue; }
      ctx.fillStyle = `hsla(${p.hue},100%,${55 + p.life * 30}%,${Math.min(1, p.life * 1.4)})`;
      ctx.fillRect(p.x, p.y, small(f) ? 1.4 : 3, small(f) ? 1.4 : 3);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
};

type Fly = { x: number; y: number; p: number; s: number };
const fireflies: Scene = {
  id: 'fireflies', name: 'Fireflies',
  setup: f => Array.from({ length: small(f) ? 18 : 70 }, () => ({ x: Math.random(), y: 0.25 + Math.random() * 0.65, p: Math.random() * TAU, s: 0.3 + Math.random() }) as Fly),
  draw: (f, flies: Fly[]) => {
    const { ctx, w, h, t } = f;
    // A summer night: fireflies wander and glow with the music, tall grass in front.
    const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#02060e'); bg.addColorStop(1, '#06180f');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    flies.forEach((fl, i) => {
      fl.x += (Math.sin(t * 0.007 * fl.s + fl.p) * 0.0009) * f.step; fl.y += (Math.cos(t * 0.006 * fl.s + fl.p * 2) * 0.0007) * f.step;
      const v = f.band(i % 32, 32), pulse = 0.25 + 0.75 * Math.max(v, (Math.sin(t * 0.05 * fl.s + fl.p) + 1) / 4);
      const r = Math.min(w, h) * (small(f) ? 0.03 : 0.022) * (0.6 + pulse);
      const g = ctx.createRadialGradient(fl.x * w, fl.y * h, 0, fl.x * w, fl.y * h, r);
      g.addColorStop(0, `rgba(230,255,140,${pulse})`); g.addColorStop(0.25, `rgba(180,255,90,${pulse * 0.5})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(fl.x * w - r, fl.y * h - r, r * 2, r * 2);
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(16,44,26,0.95)'; ctx.lineWidth = small(f) ? 1 : 2.2;
    for (let i = 0; i < (small(f) ? 40 : 160); i++) {
      const x = (i / (small(f) ? 40 : 160)) * w, tall = h * (0.12 + ((i * 37) % 13) / 60);
      const lean = Math.sin(t * 0.01 + i) * 6 + f.bass * 10;
      ctx.beginPath(); ctx.moveTo(x, h); ctx.quadraticCurveTo(x + lean * 0.5, h - tall * 0.6, x + lean, h - tall); ctx.stroke();
    }
  }
};

/** Which scene shows each feeling (a second one for variety, picked per song). */
export const MOOD_SCENES: Record<string, string[]> = {
  sad: ['rain', 'snow'], romantic: ['petals'], uplifting: ['sunrise'], energetic: ['fireworks'], calm: ['fireflies', 'snow']
};

// ---------- Fractals ----------


const mandelbrot: Scene = { gl: mandelbrotGl, id: 'mandelbrot', name: 'Mandelbrot' };

const julia: Scene = { gl: juliaGl, id: 'julia', name: 'Julia' };


type TreeState = { stars: [number, number, number][]; spread: Float32Array; petals: { x: number; y: number; vx: number; vy: number; life: number; hue: number }[]; tips: [number, number][] };
const fractalTree: Scene = {
  id: 'tree', name: 'Fractal tree',
  setup: () => ({
    stars: Array.from({ length: 140 }, () => [Math.random(), Math.random() * 0.7, Math.random()] as [number, number, number]),
    spread: new Float32Array(12).fill(0.45), petals: [], tips: []
  }),
  draw: (f, s: TreeState) => {
    const { ctx, w, h, hue, bass, treble, beat, t } = f;
    // Night sky, a low moon, faint stars.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#05060f'); sky.addColorStop(0.7, '#0d1028'); sky.addColorStop(1, '#1a1433');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    const moon = ctx.createRadialGradient(w * 0.8, h * 0.22, 0, w * 0.8, h * 0.22, Math.min(w, h) * 0.35);
    moon.addColorStop(0, 'rgba(255,240,220,0.5)'); moon.addColorStop(0.08, 'rgba(255,240,220,0.25)'); moon.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = moon; ctx.fillRect(0, 0, w, h);
    if (!small(f)) for (const [x, y, k] of s.stars) { ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.5 * k * (0.6 + 0.4 * Math.sin(t * 0.03 + k * 20))})`; ctx.fillRect(x * w, y * h, 1.4, 1.4); }

    const depthMax = small(f) ? 7 : 11;
    s.tips.length = 0;
    // Each level opens with its own band (smoothed so it breathes rather than twitches).
    for (let l = 0; l < depthMax; l++) s.spread[l] = s.spread[l]! * 0.9 + (0.32 + f.band(l * 2 + 2, depthMax * 2 + 4) * 0.42) * 0.1;
    const base = Math.min(w, h);
    // Branches are collected per level and drawn in one stroke each (eleven draws, not two thousand).
    const levels: Path2D[] = Array.from({ length: depthMax }, () => new Path2D());
    const branch = (x: number, y: number, len: number, angle: number, level: number, side: number) => {
      const sway = Math.sin(t * 0.015 + level * 0.55) * 0.012 * (1 + level * 0.25) * (1 + bass * 1.5);
      const a = angle + sway;
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      // A slight curve, like real wood.
      const path = levels[level]!;
      path.moveTo(x, y);
      path.quadraticCurveTo((x + x2) / 2 + Math.cos(a + Math.PI / 2) * len * 0.1 * side, (y + y2) / 2 + Math.sin(a + Math.PI / 2) * len * 0.1 * side, x2, y2);
      if (level >= depthMax - 1) { s.tips.push([x2, y2]); return; }
      const sp = s.spread[level]!;
      branch(x2, y2, len * 0.74, a - sp, level + 1, -1);
      branch(x2, y2, len * 0.74, a + sp, level + 1, 1);
    };
    branch(w / 2, h * 0.97, base * (0.2 + bass * 0.02), -Math.PI / 2, 0, 0);
    ctx.lineCap = 'round';
    levels.forEach((path, level) => {
      const k = level / depthMax;
      ctx.strokeStyle = `hsl(${(25 + (hue + 160 - 25) * k * k) % 360},${30 + k * 50}%,${12 + k * 38}%)`;
      ctx.lineWidth = base * 0.028 * Math.pow(0.68, level);
      ctx.stroke(path);
    });

    // Blossoms at the tips, glowing with the treble; petals let go on the beat.
    ctx.globalCompositeOperation = 'lighter';
    const bs = base * (small(f) ? 0.02 : 0.008) * (0.7 + treble * 0.9);
    const bloom = new Path2D(), core = new Path2D();
    s.tips.forEach(([x, y], i) => {
      if (i % 2) return;
      bloom.moveTo(x + bs * 1.8, y); bloom.arc(x, y, bs * 1.8, 0, TAU);
      core.moveTo(x + bs * 0.6, y); core.arc(x, y, bs * 0.6, 0, TAU);
    });
    ctx.fillStyle = `hsla(${(hue + 300) % 360},90%,65%,${0.12 + treble * 0.25})`; ctx.fill(bloom);
    ctx.fillStyle = `hsla(${(hue + 320) % 360},100%,85%,${0.45 + treble * 0.4})`; ctx.fill(core);
    if (beat) for (let i = 0; i < (small(f) ? 3 : 14); i++) { const [x, y] = s.tips[Math.floor(Math.random() * s.tips.length)] ?? [w / 2, h / 2]; s.petals.push({ x, y, vx: (Math.random() - 0.5) * 0.6, vy: 0.3 + Math.random() * 0.5, life: 1, hue: (hue + 150 + Math.random() * 60) % 360 }); }
    for (let i = s.petals.length - 1; i >= 0; i--) {
      const p = s.petals[i]!;
      p.x += (p.vx + Math.sin(t * 0.03 + i) * 0.4) * f.step; p.y += (p.vy) * f.step; p.life -= (0.006) * f.step;
      if (p.life <= 0 || p.y > h) { s.petals.splice(i, 1); continue; }
      ctx.fillStyle = `hsla(${p.hue},90%,70%,${p.life * 0.8})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 4, 1.6, t * 0.05 + i, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const mist = ctx.createLinearGradient(0, h * 0.85, 0, h);
    mist.addColorStop(0, 'rgba(0,0,0,0)'); mist.addColorStop(1, `hsla(${(hue + 200) % 360},50%,30%,0.35)`);
    ctx.fillStyle = mist; ctx.fillRect(0, h * 0.85, w, h * 0.15);
  }
};

type FernState = { x: number; y: number; buf: HTMLCanvasElement; bctx: CanvasRenderingContext2D | null; size: number };
const fern: Scene = {
  id: 'fern', name: 'Fern',
  setup: () => { const buf = document.createElement('canvas'); return { x: 0, y: 0, buf, bctx: buf.getContext('2d'), size: 0 }; },
  draw: (f, s: FernState) => {
    const { ctx, w, h, hue, bass, mids, beat, t } = f;
    if (!s.bctx) return;
    // One fern grows in its own layer with trails, in colours that keep flowing...
    const size = Math.round(Math.min(w, h) * f.dpr * 0.55);
    if (s.size !== size) { s.size = size; s.buf.width = size; s.buf.height = size; }
    const b = s.bctx;
    b.globalCompositeOperation = 'source-over';
    b.fillStyle = 'rgba(0,0,0,0.12)'; b.fillRect(0, 0, size, size);
    b.globalCompositeOperation = 'lighter';
    const lean = 0.04 + (bass - 0.3) * 0.14;
    const scale = size / 10.5, ox = size / 2;
    const n = small(f) ? 900 : 4200;
    const buckets = 12;
    const pts: number[][] = Array.from({ length: buckets }, () => []);
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let nx: number, ny: number, m: number;
      if (r < 0.01) { nx = 0; ny = 0.16 * s.y; m = 0; }
      else if (r < 0.86) { nx = 0.85 * s.x + lean * s.y; ny = -lean * s.x + 0.85 * s.y + 1.6; m = 1; }
      else if (r < 0.93) { nx = 0.2 * s.x - 0.26 * s.y; ny = 0.23 * s.x + 0.22 * s.y + 1.6; m = 2; }
      else { nx = -0.15 * s.x + 0.28 * s.y; ny = 0.26 * s.x + 0.24 * s.y + 0.44; m = 3; }
      s.x = nx; s.y = ny;
      const k = Math.floor((ny * 1.3 + m * 2.5 + t * 0.05) % buckets);
      pts[k]!.push(ox + nx * scale, size - ny * scale);
    }
    const dot = Math.max(1, size / 420);
    pts.forEach((list, k) => {
      b.fillStyle = `hsla(${(hue * 2 + k * (360 / buckets)) % 360},100%,${55 + mids * 20}%,0.55)`;
      b.beginPath();
      for (let i = 0; i < list.length; i += 2) b.rect(list[i]!, list[i + 1]!, dot, dot);
      b.fill();
    });
    // ...and is turned into a slowly spinning kaleidoscope of six.
    ctx.fillStyle = 'rgba(2,0,8,0.35)'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const spin = t * 0.004 + (beat ? 0.02 : 0);
    const draw = size / f.dpr * (1 + bass * 0.12);
    for (let k = 0; k < 6; k++) {
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(spin + (k * TAU) / 6); if (k % 2) ctx.scale(-1, 1);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(s.buf, -draw / 2, -draw * 0.98, draw, draw);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    const core = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) * (0.12 + bass * 0.1));
    core.addColorStop(0, `hsla(${(hue * 2 + 40) % 360},100%,75%,${0.35 + bass * 0.4})`); core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
};

const sierpinski: Scene = { gl: sierpinskiGl, id: 'sierpinski', name: 'Sierpinski' };

/** In picker order, grouped: feelings, spectrum, waves, space, geometry, fractals, fields. */
export const SCENE_LIST: Scene[] = [
  rain, petals, sunrise, fireworks, fireflies, snow,
  bars, led, radial, pulse, spikes, vu, waterfall,
  mist, waves, aurora, scope, lissajous, terrain,
  alchemy, plenoptic, starfield, galaxy, fountain, bubbles,
  tunnel, ripples, kaleidoscope, battery, lightning, colors, matrix,
  mandelbrot, julia, fractalTree, fern, sierpinski,
  plasma, fire
];
export const SCENE_BY_ID = new Map(SCENE_LIST.map(s => [s.id, s]));
