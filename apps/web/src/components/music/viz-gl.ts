/**
 * GPU scenes: fractals and fields drawn by a fragment shader at the display's full resolution (4K included).
 * One WebGL2 context is shared by every visualizer on the page (browsers allow only a handful): each canvas asks
 * it for a frame of its size and copies the result. No WebGL2: the scene's 2D drawing is used instead.
 */

export type Uniforms = Record<string, number | [number, number] | [number, number, number]>;

export interface GlFrameInput {
  width: number; height: number;
  time: number; bass: number; mids: number; treble: number; level: number; beat: number; hue: number;
  tint: [number, number, number];
  spectrum: Uint8Array;
  /** 2 = 2x2 supersampling (smooth edges on small views); 1 = one sample per pixel (4K needs no more). */
  aa: number;
}

export interface GlScene {
  /** Fraction of the screen's pixels to compute (soft scenes look the same at half and cost a quarter). */
  resolution?: number;
  /** GLSL that defines `vec3 shade(vec2 p)`, p in pixels from the bottom left. Helpers below are in scope. */
  frag: string;
  /** Extra uniforms each frame (declare them in `frag`). */
  uniforms?: (input: GlFrameInput, state: never) => Uniforms;
  /** A float texture (two floats per texel, width = length) bound as `uData`, when it changed. */
  data?: (state: never) => { values: Float32Array; length: number; version: number } | null;
}

const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform float uTime, uBass, uMids, uTreble, uLevel, uBeat, uHue;
uniform vec3 uTint;
uniform sampler2D uSpec;
uniform int uAA;
out vec4 outColor;
const float TAU = 6.28318530718;
float spec(float x) { return texture(uSpec, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(TAU * (c * t + d)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

const FOOTER = `
void main() {
  vec3 col = vec3(0.0);
  if (uAA > 1) {
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) col += shade(gl_FragCoord.xy + (vec2(float(i), float(j)) + 0.5) / 2.0 - 0.5);
    col *= 0.25;
  } else col = shade(gl_FragCoord.xy);
  // A soft vignette, and a whisper of noise so smooth gradients never band.
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.35 * dot(q, q);
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

type Program = { prog: WebGLProgram; locs: Map<string, WebGLUniformLocation | null> };

class Renderer {
  readonly canvas = document.createElement('canvas');
  readonly gl: WebGL2RenderingContext | null;
  private programs = new Map<GlScene, Program | null>();
  private spec: WebGLTexture | null = null;
  private data = new Map<GlScene, { tex: WebGLTexture; version: number }>();

  constructor() {
    this.canvas.width = 2; this.canvas.height = 2;
    this.gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    const gl = this.gl;
    if (!gl) return;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.spec = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.spec);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  private compile(scene: GlScene): Program | null {
    const gl = this.gl!;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('visualizer shader:', gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, HEADER + scene.frag + FOOTER);
    if (!vs || !fs) return null;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('visualizer program:', gl.getProgramInfoLog(prog)); return null; }
    return { prog, locs: new Map() };
  }

  /** Draws one frame of `scene` into the bottom-left `width` x `height` of the shared canvas. False if it cannot. */
  render(scene: GlScene, state: unknown, input: GlFrameInput): boolean {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return false;
    if (!this.programs.has(scene)) this.programs.set(scene, this.compile(scene));
    const p = this.programs.get(scene);
    if (!p) return false;
    const { width: w, height: h } = input;
    // Grow only (shrinking would reallocate every time a smaller view draws).
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w);
      this.canvas.height = Math.max(this.canvas.height, h);
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.prog);
    const loc = (name: string) => { if (!p.locs.has(name)) p.locs.set(name, gl.getUniformLocation(p.prog, name)); return p.locs.get(name)!; };
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.spec);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, input.spectrum.length, 1, 0, gl.RED, gl.UNSIGNED_BYTE, input.spectrum);
    gl.uniform1i(loc('uSpec'), 0);

    const data = scene.data?.(state as never);
    if (data) {
      let entry = this.data.get(scene);
      if (!entry) {
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
        entry = { tex, version: -1 };
        this.data.set(scene, entry);
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      if (entry.version !== data.version) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, data.length, 1, 0, gl.RG, gl.FLOAT, data.values);
        entry.version = data.version;
      }
      gl.uniform1i(loc('uData'), 1);
    }

    gl.uniform2f(loc('uRes'), w, h);
    gl.uniform1f(loc('uTime'), input.time);
    gl.uniform1f(loc('uBass'), input.bass);
    gl.uniform1f(loc('uMids'), input.mids);
    gl.uniform1f(loc('uTreble'), input.treble);
    gl.uniform1f(loc('uLevel'), input.level);
    gl.uniform1f(loc('uBeat'), input.beat);
    gl.uniform1f(loc('uHue'), input.hue / 360);
    gl.uniform3f(loc('uTint'), input.tint[0] / 255, input.tint[1] / 255, input.tint[2] / 255);
    gl.uniform1i(loc('uAA'), input.aa);
    for (const [name, value] of Object.entries(scene.uniforms?.(input, state as never) ?? {})) {
      const l = loc(name);
      if (typeof value === 'number') { if (/^uI[A-Z]/.test(name)) gl.uniform1i(l, value); else gl.uniform1f(l, value); }
      else if (value.length === 2) gl.uniform2f(l, value[0], value[1]);
      else gl.uniform3f(l, value[0], value[1], value[2]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }
}

let shared: Renderer | null | undefined;
/** The shared GPU renderer, or null when this browser has no WebGL2. */
export function glRenderer(): Renderer | null {
  if (shared === undefined) {
    try { shared = new Renderer(); if (!shared.gl) shared = null; } catch { shared = null; }
  }
  return shared;
}

/** Copies the last frame the renderer drew (width x height) onto a 2D canvas, scaled to fill it. */
export function blitGl(ctx: CanvasRenderingContext2D, width: number, height: number, cssW: number, cssH: number): void {
  const r = glRenderer();
  if (!r) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // WebGL draws from the bottom left; the canvas reads from the top left.
  ctx.drawImage(r.canvas, 0, r.canvas.height - height, width, height, 0, 0, cssW, cssH);
}
