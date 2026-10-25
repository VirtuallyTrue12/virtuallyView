import type { GlFrameInput, GlScene } from './viz-gl';

/**
 * The GPU versions of the fractal and field scenes (see viz-gl). Each is resolution independent: it is computed
 * for every pixel of the screen, so it stays sharp from a phone to a 4K television.
 */

const CMUL = 'vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }\n';

// ---------- Mandelbrot: an endless, seamless zoom ----------

/**
 * Near c = i the set repeats itself: zoomed 4·√2 times and turned 45 degrees it is the same picture again
 * (c = i lands on a cycle whose multiplier is 4(1 + i)). So the view zooms through one such step and starts over,
 * blending the last fifth into the first: an endless dive with no cut and no loss of sharpness. Colour follows
 * the distance to the set measured against the size of the view, which repeats exactly with the picture.
 */
type MandelState = { s: number; last: number };
export const mandelbrotGl: GlScene & { setup: () => MandelState } = {
  setup: () => ({ s: 0, last: 0 }),
  uniforms: (f: GlFrameInput, st: MandelState) => {
    const dt = Math.min(0.1, Math.max(0, f.time - st.last)); st.last = f.time;
    st.s = (st.s + dt * (0.055 + f.bass * 0.07)) % 1;
    return { uS: st.s };
  },
  frag: CMUL + `
uniform float uS;
const float LAMBDA = 5.656854249; // |4(1 + i)|
const float Z0 = 150.0;
vec3 frame(vec2 p, float s) {
  float zoom = Z0 * pow(LAMBDA, s);
  float span = 3.4 / zoom;
  float unit = span / min(uRes.x, uRes.y);
  // rot(a) turns by -a: the view turns 45 degrees per step, matching the set.
  // Framed a little to the side of i, where the branches are; the same framing repeats at every step.
  vec2 c = vec2(0.0, 1.0) + rot(0.785398163 * s) * ((p - 0.5 * uRes) * unit + vec2(-0.32, 0.14) * span);
  vec2 z = vec2(0.0), dz = vec2(0.0);
  float it = -1.0;
  for (int i = 0; i < 600; i++) {
    dz = 2.0 * cmul(z, dz) + vec2(1.0, 0.0);
    z = cmul(z, z) + c;
    if (dot(z, z) > 1e8) { it = float(i); break; }
  }
  if (it < 0.0) return vec3(0.015, 0.012, 0.03);
  float r = length(z);
  float de = 0.5 * r * log(r) / max(length(dz), 1e-30);
  float px = de / unit;
  float rel = log2(de / span); // the same at this zoom and one step deeper
  vec3 col = pal(rel * 0.11 + uHue * 0.6, vec3(0.5), vec3(0.45), vec3(1.0), vec3(0.62, 0.48, 0.32));
  col *= 0.28 + 0.72 * exp(rel * 0.18);
  // The filaments: a crisp, anti-aliased line with a soft halo that breathes with the bass.
  float line = smoothstep(1.4, 0.0, px);
  float halo = exp(-px * 0.06) * (0.35 + uBass * 0.9 + uBeat * 0.5);
  return col + vec3(1.0, 0.94, 0.86) * (line * 0.9 + halo * 0.35);
}
vec3 shade(vec2 p) {
  vec3 col = frame(p, uS);
  float w = smoothstep(0.8, 1.0, uS);
  if (w > 0.0) col = mix(col, frame(p, uS - 1.0), w);
  return col;
}`
};

// ---------- Julia: a shape that keeps changing ----------

type JuliaState = { a: number; last: number };
export const juliaGl: GlScene & { setup: () => JuliaState } = {
  setup: () => ({ a: 0, last: 0 }),
  uniforms: (f: GlFrameInput, s: JuliaState) => {
    const dt = Math.min(0.1, Math.max(0, f.time - s.last)); s.last = f.time;
    s.a += dt * (0.05 + f.mids * 0.25);
    // c walks the edge of the Mandelbrot set's main body, where Julia sets are richest.
    const k = 0.985 + f.bass * 0.012;
    const cx = (0.5 * Math.cos(s.a) - 0.25 * Math.cos(2 * s.a)) * k, cy = (0.5 * Math.sin(s.a) - 0.25 * Math.sin(2 * s.a)) * k;
    return { uC: [cx, cy], uRot: f.time * 0.03, uZoomJ: 1 + f.bass * 0.06 + f.beat * 0.05 };
  },
  frag: CMUL + `
uniform vec2 uC;
uniform float uRot, uZoomJ;
vec3 shade(vec2 p) {
  float unit = 3.0 / uZoomJ / min(uRes.x, uRes.y);
  vec2 z = rot(uRot) * ((p - 0.5 * uRes) * unit);
  vec2 dz = vec2(1.0, 0.0);
  float it = -1.0, trap = 1e9;
  vec2 seen = z;
  for (int i = 0; i < 180; i++) {
    dz = 2.0 * cmul(z, dz);
    z = cmul(z, z) + uC;
    trap = min(trap, dot(z, z));
    if (dot(z, z) > 1024.0) { it = float(i); break; }
    // Inside points settle into a cycle: once the orbit comes back to where it was, stop early.
    if ((i & 15) == 15) { if (dot(z - seen, z - seen) < 1e-9) break; seen = z; }
  }
  if (it < 0.0) return pal(sqrt(trap) * 1.5 + uTime * 0.02 + uHue, vec3(0.25), vec3(0.25), vec3(1.0), vec3(0.6, 0.7, 0.8)) * (0.35 + uBass * 0.4);
  float r = length(z);
  float mu = it + 1.0 - log2(log(r));
  float px = r * log(r) / max(length(dz), 1e-30) / unit;
  vec3 c = pal(mu * 0.03 + uHue + uTime * 0.01, vec3(0.5), vec3(0.5), vec3(1.0, 0.9, 0.8), vec3(0.3, 0.2, 0.2));
  c *= 0.1 + 0.9 * smoothstep(0.0, 1.0, exp(-px * 0.02));
  c += exp(-px * 0.6) * (0.5 + uTreble * 0.8 + uBeat * 0.3);
  return c;
}`
};

// ---------- Plasma: liquid colour ----------

export const plasmaGl: GlScene = {
  resolution: 0.5,
  frag: `
vec3 shade(vec2 p) {
  vec2 uv = p / min(uRes.x, uRes.y) * 2.2;
  float t = uTime * 0.09;
  // Warped noise, warped again: slow liquid folds that the bass stirs.
  vec2 q = vec2(fbm(uv + vec2(0.0, t)), fbm(uv + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(uv + 3.2 * q + vec2(1.7, 9.2) + 0.15 * t + uBass * 0.6), fbm(uv + 3.2 * q + vec2(8.3, 2.8) - 0.12 * t));
  float f = fbm(uv + 3.6 * r);
  vec3 c = pal(f * 1.1 + length(q) * 0.6 + uHue, vec3(0.45, 0.4, 0.55), vec3(0.45, 0.4, 0.45), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.33, 0.67));
  c = mix(c, uTint, 0.15);
  return c * (0.1 + 0.95 * f * f + uBass * 0.2 + uBeat * 0.12);
}`
};

// ---------- Fire ----------

export const fireGl: GlScene = {
  resolution: 0.6,
  frag: `
vec3 shade(vec2 p) {
  vec2 uv = p / uRes;
  float x = (uv.x - 0.5) * uRes.x / uRes.y;
  // Turbulence that rises; each column burns as high as its band of the music.
  vec2 q = vec2(x * 3.0, uv.y * 2.4 - uTime * 1.3);
  float n = fbm(q + vec2(0.0, fbm(q * 1.7 - vec2(0.0, uTime * 0.4)) * 1.2));
  float band = spec(abs(uv.x - 0.5) * 1.6);
  float height = 0.1 + band * 0.55 + uBass * 0.12;
  float flame = clamp((height - uv.y) * 1.7 + n * 1.1 - 0.5, 0.0, 1.0);
  flame = flame * flame * (3.0 - 2.0 * flame);
  vec3 c = vec3(1.0, 0.3, 0.05) * flame + vec3(0.55, 0.42, 0.12) * pow(flame, 3.0) + vec3(0.25, 0.25, 0.3) * pow(flame, 12.0);
  // Sparks drifting up.
  vec2 g = vec2(x * 22.0, uv.y * 22.0 - uTime * 6.0);
  float spark = step(0.985, hash(floor(g))) * smoothstep(0.35, 0.0, length(fract(g) - 0.5)) * (1.0 - uv.y) * (0.4 + uTreble);
  return c + vec3(1.0, 0.6, 0.2) * spark;
}`
};

// ---------- Sierpinski: an endless zoom ----------

type SierpState = { z: number; k: number; last: number };
export const sierpinskiGl: GlScene & { setup: () => SierpState } = {
  setup: () => ({ z: 1, k: 0, last: 0 }),
  uniforms: (f: GlFrameInput, s: SierpState) => {
    const dt = Math.min(0.1, Math.max(0, f.time - s.last)); s.last = f.time;
    s.z *= Math.pow(2, dt * (0.12 + f.bass * 0.35 + f.beat * 0.2));
    // At twice the size it looks exactly the same: swap back and count a level, so the zoom never ends.
    while (s.z >= 2) { s.z /= 2; s.k++; }
    return { uZ: s.z, uK: s.k };
  },
  frag: `
uniform float uZ, uK;
vec3 shade(vec2 p) {
  float side = max(uRes.x, uRes.y * 1.16) * 1.15 * uZ;
  vec2 t = (p - vec2(uRes.x * 0.04, uRes.y * 0.02)) / side;
  float v = t.y / 0.8660254, u = t.x - 0.5 * v;
  vec3 bg = vec3(0.02, 0.02, 0.05) + uTint * 0.04;
  if (u < 0.0 || v < 0.0 || u + v > 1.0) return bg;
  float level = -1.0;
  for (int i = 0; i < 30; i++) {
    u *= 2.0; v *= 2.0;
    if (u >= 1.0) u -= 1.0; else if (v >= 1.0) v -= 1.0; else if (u + v > 1.0) { level = float(i); break; }
  }
  if (level < 0.0) return vec3(1.0);
  // Colour by the absolute depth (the level plus the levels zoomed past), so nothing jumps when the zoom wraps.
  float depth = level + uK;
  float band = spec(fract(depth * 0.071) * 0.9);
  vec3 c = pal(depth * 0.06 + uHue + uTime * 0.01, vec3(0.45), vec3(0.4), vec3(1.0), vec3(0.0, 0.1, 0.2));
  // Inside each hole, light gathers toward its edges.
  float edge = min(min(1.0 - u, 1.0 - v), u + v - 1.0);
  return c * (0.25 + band * 0.9 + uBeat * 0.3) * (0.35 + 0.65 * smoothstep(0.35, 0.0, edge));
}`
};

// ---------- Tunnel: flying down a tube of light ----------

type TunnelState = { dist: number; last: number };
export const tunnelGl: GlScene & { setup: () => TunnelState } = {
  setup: () => ({ dist: 0, last: 0 }),
  uniforms: (f: GlFrameInput, s: TunnelState) => {
    const dt = Math.min(0.1, Math.max(0, f.time - s.last)); s.last = f.time;
    // Distance only ever grows: the bass speeds the flight up a little, it never stops or runs backwards.
    s.dist += dt * (0.9 + f.bass * 0.6);
    return { uDist: s.dist };
  },
  frag: `
uniform float uDist;
vec3 shade(vec2 p) {
  vec2 uv = (p - 0.5 * uRes) / min(uRes.x, uRes.y);
  uv *= rot(uTime * 0.1);
  float r = length(uv), a = atan(uv.y, uv.x);
  float z = 0.35 / max(r, 0.02) + uDist;
  // Rings rush toward you; ridges round the wall follow the spectrum.
  float ridges = spec(abs(fract(a / TAU * 2.0) - 0.5) * 2.0);
  float rings = smoothstep(0.06 + ridges * 0.12, 0.0, 0.5 - abs(fract(z * 2.0) - 0.5));
  float grid = smoothstep(0.035, 0.0, 0.5 - abs(fract(a / TAU * 16.0 + z * 0.1) - 0.5));
  vec3 c = pal(z * 0.05 + uHue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.2, 0.4));
  float fog = smoothstep(0.0, 0.35, r);
  // A kick: the rings flare and a shockwave runs out from the centre.
  float wave = uBeat * smoothstep(0.08, 0.0, abs(r - (1.0 - uBeat) * 0.9));
  return c * (rings * (0.6 + uBeat * 0.8) + grid * 0.35 + 0.05) * fog + c * wave * 1.5 + vec3(1.0, 0.9, 0.8) * exp(-r * 12.0) * (0.3 + uBass);
}`
};

// ---------- Aurora: curtains of light over snow ----------

export const auroraGl: GlScene = {
  resolution: 0.5,
  frag: `
vec3 shade(vec2 p) {
  vec2 uv = p / uRes;
  vec3 c = mix(vec3(0.01, 0.02, 0.06), vec3(0.03, 0.06, 0.12), uv.y);
  // Stars.
  vec2 g = floor(p / 3.0);
  c += vec3(step(0.997, hash(g)) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(g + 1.0) * 40.0)));
  // Three curtains: folded noise ribbons that brighten with their band.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = uv.x * (2.5 + fi) + uTime * (0.04 + 0.02 * fi);
    float base = 0.55 + 0.12 * fi + 0.15 * (fbm(vec2(x, fi * 3.0 + uTime * 0.05)) - 0.5);
    float d = uv.y - base;
    float ray = fbm(vec2(x * 6.0, uTime * 0.2 + fi));
    float curtain = exp(-max(d, 0.0) * 9.0) * smoothstep(-0.32, 0.0, d) * ray;
    float b = 0.4 + spec(0.15 + fi * 0.25) * 1.4;
    vec3 col = mix(vec3(0.1, 1.0, 0.55), vec3(0.6, 0.25, 1.0), smoothstep(0.0, 0.25, d + 0.1) + fi * 0.2);
    c += col * curtain * b * 0.9;
  }
  // Snowy ground reflecting it.
  float ground = smoothstep(0.17, 0.15, uv.y + 0.02 * sin(uv.x * 9.0));
  c = mix(c, vec3(0.08, 0.1, 0.14) + c * 0.25, ground);
  return c;
}`
};

// ---------- Kaleidoscope ----------

export const kaleidoGl: GlScene = {
  frag: `
vec3 shade(vec2 p) {
  vec2 uv = (p - 0.5 * uRes) / min(uRes.x, uRes.y);
  float r = length(uv), a = atan(uv.y, uv.x) + uTime * 0.05;
  float seg = TAU / 12.0;
  a = abs(mod(a, seg) - seg * 0.5);
  vec2 k = vec2(cos(a), sin(a)) * r;
  k *= 2.2 + uBass * 0.8;
  k += vec2(uTime * 0.15, 0.0);
  // One noise pass, warped by a cheap swirl instead of a second noise pass.
  float f = fbm(k + vec2(sin(k.y * 1.7 + uTime * 0.3), cos(k.x * 1.3 - uTime * 0.25)) * 0.7);
  float lines = smoothstep(0.03, 0.0, abs(fract(f * 6.0 + uTime * 0.2) - 0.5) - 0.44);
  vec3 c = pal(f * 1.4 + r * 0.6 + uHue, vec3(0.45), vec3(0.38), vec3(1.0), vec3(0.0, 0.33, 0.67));
  return c * (0.08 + f * f * 1.1 + uBeat * 0.15) + lines * c * (0.35 + uTreble);
}`
};

// ---------- Ocean mist: layers of fog over water ----------

export const mistGl: GlScene = {
  resolution: 0.6,
  frag: `
vec3 shade(vec2 p) {
  vec2 uv = p / uRes;
  vec3 c = mix(vec3(0.02, 0.05, 0.1), vec3(0.08, 0.12, 0.22), uv.y);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float h = 0.62 - fi * 0.11 + 0.08 * (fbm(vec2(uv.x * (2.0 + fi) + uTime * 0.05 * (fi + 1.0), fi * 7.0)) - 0.5) * (1.0 + uBass * 2.0);
    float layer = smoothstep(h + 0.02, h - 0.06, uv.y);
    vec3 col = pal(fi * 0.12 + uHue * 0.5 + 0.5, vec3(0.4, 0.5, 0.6), vec3(0.25), vec3(1.0), vec3(0.0, 0.1, 0.2));
    c = mix(c, col * (0.35 + fi * 0.1 + spec(0.1 + fi * 0.18) * 0.5), layer * 0.55);
  }
  return c;
}`
};

// ---------- Musical colors: pools of light that merge ----------

type ColorsState = { pos: number[]; col: number[] };
export const colorsGl: GlScene & { setup: () => ColorsState } = {
  setup: () => ({ pos: new Array(48).fill(0), col: new Array(48).fill(0) }),
  uniforms: (f: GlFrameInput, s: ColorsState) => {
    for (let i = 0; i < 12; i++) {
      s.pos[i * 4] = 0.45 * Math.sin(f.time * (0.21 + i * 0.031) + i * 1.7);
      s.pos[i * 4 + 1] = 0.45 * Math.cos(f.time * (0.17 + i * 0.027) + i * 2.3);
      s.pos[i * 4 + 2] = 0.05 + (f.spectrum[Math.floor((i / 12) * 127)]! / 255) * 0.12;
      const k = i / 12 + f.hue / 360;
      [0, 0.33, 0.67].forEach((d, ch) => { s.col[i * 4 + ch] = 0.5 + 0.5 * Math.cos(Math.PI * 2 * (k + d)); });
    }
    return { uBlob: s.pos, uBlobCol: s.col };
  },
  frag: `
uniform vec4 uBlob[12];
uniform vec4 uBlobCol[12];
vec3 shade(vec2 p) {
  vec2 uv = (p - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec3 acc = vec3(0.0);
  float field = 0.0;
  for (int i = 0; i < 12; i++) {
    vec2 d = uv - uBlob[i].xy;
    float v = uBlob[i].z * uBlob[i].z / max(dot(d, d), 1e-4);
    field += v;
    acc += uBlobCol[i].rgb * v;
  }
  vec3 col = acc / max(field, 1e-4);
  return col * (0.08 + 0.92 * smoothstep(0.9, 1.1, field)) + col * pow(field, 0.6) * 0.15;
}`
};

