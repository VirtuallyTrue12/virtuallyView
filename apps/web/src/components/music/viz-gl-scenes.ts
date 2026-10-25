import type { GlFrameInput, GlScene } from './viz-gl';

/**
 * The GPU versions of the fractal and field scenes (see viz-gl). Each is resolution independent: it is computed
 * for every pixel of the screen, so it stays sharp from a phone to a 4K television.
 */

const CMUL = 'vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }\n';

// ---------- Mandelbrot: an endless deep zoom ----------

/**
 * Deep zoom by perturbation: one reference orbit is worked out here in double precision, and each pixel only
 * follows its small difference from it, which single-precision GPU maths can do accurately. That keeps the
 * picture sharp a billion times deeper than plain GPU maths. The view glides into a point on the edge of the set
 * and back out (no cut), then picks another point while it shows the whole set.
 */
const TARGETS: [number, number, number][] = [
  [-0.743643887037158704752191506114774, 0.131825904205311970493132056385139, 1e6], // seahorse valley
  [-1.401155189092050, 0, 1e6], // the Feigenbaum point: minibrots within minibrots
  [-0.10109636384562, 0.95628651080914, 1e6], // a spiral arm's tip
  [0, 1, 1e6], // c = i: dendrites forever
  [-0.7746806106269039, -0.1374168856037867, 1e6] // double spirals
];
const FULL: [number, number] = [-0.6, 0];
const REF_LEN = 2600;

type MandelState = { cycle: number; phase: number; last: number; target: [number, number, number]; ref: Float32Array; version: number };

function referenceOrbit(cx: number, cy: number): Float32Array {
  const out = new Float32Array(REF_LEN * 2);
  let x = 0, y = 0;
  for (let i = 0; i < REF_LEN; i++) {
    out[i * 2] = x; out[i * 2 + 1] = y;
    const nx = x * x - y * y + cx; y = 2 * x * y + cy; x = nx;
    // Escaped: the rest stays put; pixels rebase to the start when they reach it.
    if (x * x + y * y > 1e8) { for (let k = i + 1; k < REF_LEN; k++) { out[k * 2] = x; out[k * 2 + 1] = y; } break; }
  }
  return out;
}

export const mandelbrotGl: GlScene & { setup: () => MandelState } = {
  setup: () => ({ cycle: -1, phase: 0, last: 0, target: TARGETS[0]!, ref: referenceOrbit(TARGETS[0]![0], TARGETS[0]![1]), version: 0 }),
  data: (s: MandelState) => ({ values: s.ref, length: REF_LEN, version: s.version }),
  uniforms: (f: GlFrameInput, s: MandelState) => {
    const dt = Math.min(0.1, Math.max(0, f.time - s.last)); s.last = f.time;
    // About two minutes in and out; the music hurries it along.
    s.phase += dt * (1 + f.bass * 0.5) / 90;
    const cycle = Math.floor(s.phase);
    if (cycle !== s.cycle) {
      s.cycle = cycle;
      s.target = TARGETS[cycle % TARGETS.length]!;
      s.ref = referenceOrbit(s.target[0], s.target[1]);
      s.version++;
    }
    const p = s.phase - cycle;
    const ease = 0.5 - 0.5 * Math.cos(Math.PI * 2 * p); // 0 → 1 → 0: smooth at both ends, no cut
    const zoom = Math.exp(Math.log(s.target[2]) * ease);
    // Zoom about the target: the whole set at zoom 1, closing in on the target as the zoom grows.
    const dcx = (FULL[0] - s.target[0]) / zoom, dcy = (FULL[1] - s.target[1]) / zoom;
    const span = 3.4 / zoom;
    return {
      uDc0: [dcx, dcy], uScale: span / Math.min(f.width, f.height * 1.6), uRot: f.time * 0.015,
      uIMaxIter: Math.min(900, Math.round(200 + 90 * Math.log10(zoom))), uIRefLen: REF_LEN
    };
  },
  frag: CMUL + `
uniform sampler2D uData;
uniform int uIRefLen, uIMaxIter;
uniform vec2 uDc0;
uniform float uScale, uRot;
vec3 shade(vec2 p) {
  vec2 dc = uDc0 + rot(uRot) * ((p - 0.5 * uRes) * uScale);
  vec2 d = vec2(0.0), z = vec2(0.0), dz = vec2(0.0);
  int n = 0; float it = -1.0;
  for (int i = 0; i < 2400; i++) {
    if (i >= uIMaxIter) break;
    vec2 Z = texelFetch(uData, ivec2(n, 0), 0).xy;
    z = Z + d;
    dz = 2.0 * cmul(z, dz) + vec2(1.0, 0.0);
    d = cmul(2.0 * Z + d, d) + dc;
    n++;
    z = texelFetch(uData, ivec2(n, 0), 0).xy + d;
    float zz = dot(z, z);
    if (zz > 1e5) { it = float(i); break; }
    // Rebase when the pixel's orbit passes closer to zero than its difference, or the reference ran out.
    if (zz < dot(d, d) || n >= uIRefLen - 1) { d = z; n = 0; }
  }
  if (it < 0.0) return vec3(0.02, 0.02, 0.05) + uTint * (0.05 + uBass * 0.25);
  float r = length(z);
  float mu = it + 1.0 - log2(log(r));
  float px = r * log(r) / max(length(dz), 1e-30) / uScale; // distance to the set, in pixels
  vec3 c = pal(mu * 0.018 + uTime * 0.015 + uHue, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.1, 0.2));
  float glow = exp(-px * 0.5);
  c *= 0.25 + 0.75 * smoothstep(0.0, 1.0, exp(-px * 0.008));
  c += glow * (0.55 + uBass * 0.8 + uBeat * 0.4) * vec3(1.0, 0.93, 0.85);
  return c;
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
  for (int i = 0; i < 260; i++) {
    dz = 2.0 * cmul(z, dz);
    z = cmul(z, z) + uC;
    trap = min(trap, length(z - vec2(0.25 * sin(uTime * 0.3), 0.0)));
    if (dot(z, z) > 1e5) { it = float(i); break; }
  }
  if (it < 0.0) return pal(trap * 1.5 + uTime * 0.02 + uHue, vec3(0.25), vec3(0.25), vec3(1.0), vec3(0.6, 0.7, 0.8)) * (0.35 + uBass * 0.4);
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
  float f = fbm(k + fbm(k * 1.5 + uTime * 0.1) * 1.4);
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

export const colorsGl: GlScene = {
  frag: `
vec3 shade(vec2 p) {
  vec2 uv = (p - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec3 acc = vec3(0.0);
  float field = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    vec2 c = 0.45 * vec2(sin(uTime * (0.21 + fi * 0.031) + fi * 1.7), cos(uTime * (0.17 + fi * 0.027) + fi * 2.3));
    float s = 0.05 + spec(fi / 12.0) * 0.12;
    float v = s * s / max(dot(uv - c, uv - c), 1e-4);
    field += v;
    acc += pal(fi / 12.0 + uHue, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)) * v;
  }
  vec3 col = acc / max(field, 1e-4);
  float edge = smoothstep(0.9, 1.1, field);
  return col * (0.08 + 0.92 * edge) + col * pow(field, 0.6) * 0.15;
}`
};

// ---------- Alchemy: mirrored swirls of light ----------

type AlchemyState = { swirl: number; last: number };
export const alchemyGl: GlScene & { setup: () => AlchemyState } = {
  setup: () => ({ swirl: 0, last: 0 }),
  uniforms: (f: GlFrameInput, s: AlchemyState) => {
    const dt = Math.min(0.1, Math.max(0, f.time - s.last)); s.last = f.time;
    s.swirl += dt * (1 + f.bass * 3);
    return { uSwirl: s.swirl };
  },
  frag: `
uniform float uSwirl;
vec3 shade(vec2 p) {
  vec2 uv = (p - 0.5 * uRes) / min(uRes.x, uRes.y);
  float r = length(uv), a = atan(uv.y, uv.x);
  float seg = TAU / 8.0;
  a = abs(mod(a, seg) - seg * 0.5); // eight mirrored wedges
  vec2 q = vec2(cos(a), sin(a)) * r;
  vec3 col = vec3(0.0);
  // Sparks spiral outward and fade; each is a sharp point with a soft halo, so it stays crisp at any size.
  for (int i = 0; i < 48; i++) {
    float fi = float(i);
    float life = fract(uSwirl * 0.05 * (0.6 + hash(vec2(fi, 1.0))) + hash(vec2(fi, 2.0)));
    float ang = hash(vec2(fi, 3.0)) * seg + life * 2.5 * (0.5 + hash(vec2(fi, 4.0)));
    ang = abs(mod(ang, seg) - seg * 0.5);
    vec2 pos = vec2(cos(ang), sin(ang)) * life * 0.6;
    float size = 0.003 + 0.009 * (1.0 - life) + uBass * 0.005;
    float d2 = dot(q - pos, q - pos);
    float glow = size * size / (d2 + size * size * 0.25);
    col += pal(life * 0.6 + uHue + fi * 0.013, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)) * glow * (1.0 - life) * 0.45;
  }
  col += uTint * exp(-r * 6.0) * (0.15 + uBass * 0.5);
  return col;
}`
};
