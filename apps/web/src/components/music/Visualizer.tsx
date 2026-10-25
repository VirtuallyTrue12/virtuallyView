import { useEffect, useMemo, useRef } from 'react';
import { audioEngine } from '../../lib/audio-engine';
import { setViz, useLyrics, useViz, type LyricLine, type LyricStyle, type SceneId } from '../../lib/viz-store';
import { blitGl, glRenderer } from './viz-gl';
import { MOOD_SCENES, SCENE_BY_ID, SCENE_LIST, type Frame, type Scene, type Variant } from './viz-scenes';
import { moodFromEnergy, songMood, type Mood } from '../../lib/mood';
import { useMusicPlayer } from '../media/MusicProvider';

const MOOD_ORDER: Mood[] = ['sad', 'romantic', 'uplifting', 'energetic', 'calm'];

/**
 * Music visualizations in the spirit of the classic desktop media players: bars, a drifting mist, a mirrored
 * "alchemy" kaleidoscope, a radial tunnel and an oscilloscope. All original drawings, fed by the player's analyser,
 * so they move with what is actually playing (equalizer included).
 */
export const SCENES: { id: SceneId; name: string }[] = [{ id: 'mood', name: 'By mood' }, ...SCENE_LIST.map(sc => ({ id: sc.id, name: sc.name })), { id: 'cycle', name: 'Cycle all' }];

/** The playing song's feeling from its words, for the "By mood" scene (null while unknown or unclear). */
function useSongMood(on: boolean): { key: string; mood: Mood | null } {
  const { entry } = useMusicPlayer();
  const lyrics = useLyrics(entry?.artistTitle, entry?.track.title, entry?.albumTitle, entry?.track.durationMs ? entry.track.durationMs / 1000 : undefined, on);
  const key = entry ? String(entry.track.id) : '';
  const mood = useMemo(() => (entry && lyrics !== undefined ? songMood({
    title: entry.track.title, genres: entry.genres, lyrics: lyrics?.synced?.map(l => l.text) ?? lyrics?.plain?.split('\n')
  }) : null), [entry, lyrics]);
  return { key, mood };
}

export type MoodPick = { mood: Mood; scene: string; byEnergy: boolean };

/**
 * One canvas drawing one scene (see viz-scenes). `full` fills a stage, `strip` is the thin spectrum on the bottom
 * bar and `tile` is a small live preview in the scene picker.
 */
export function VizCanvas({ scene, tint = '120, 128, 160', variant = 'full', className, onMood }: { scene: SceneId; tint?: string; variant?: Variant; className?: string; onMood?: (pick: MoodPick | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const song = useSongMood(scene === 'mood' && variant !== 'tile');
  const songRef = useRef(song); songRef.current = song;
  const onMoodRef = useRef(onMood); onMoodRef.current = onMood;

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    let raf = 0;
    const dpr = Math.min(variant === 'full' ? 3 : 1.5, window.devicePixelRatio || 1);
    // Quality: 1 = the display's full pixel density (up to 4K); lowered a step when frames start to drop.
    let q = 1, scale = dpr;
    const budget = variant === 'full' ? 3840 * 2160 : 320 * 200;
    const freq = new Uint8Array(1024);
    const wave = new Uint8Array(2048);
    // A small pixel buffer for the pixel scenes (plasma, fire), drawn scaled up.
    const loCanvas = document.createElement('canvas');
    loCanvas.width = variant === 'tile' ? 64 : 160; loCanvas.height = variant === 'tile' ? 40 : 96;
    const loCtx = loCanvas.getContext('2d')!;
    const f: Frame = {
      ctx, w: 0, h: 0, dpr, t: 0, variant, freq, wave, bass: 0, mids: 0, treble: 0, level: 0, hue: 0, beat: false,
      tint: tint.split(',').map(x => Number(x.trim()) || 128).slice(0, 3) as [number, number, number],
      // Log-spaced from 35 Hz to 16 kHz, each the loudest bin in its slice, so every band moves.
      band: (i, count) => {
        const rate = audioEngine.ctx?.sampleRate ?? 48000;
        const bins = audioEngine.analyser?.frequencyBinCount ?? 1024;
        const f0 = 35 * Math.pow(16000 / 35, i / count), f1 = 35 * Math.pow(16000 / 35, (i + 1) / count);
        const b0 = Math.max(1, Math.floor((f0 / (rate / 2)) * bins)), b1 = Math.max(b0 + 1, Math.ceil((f1 / (rate / 2)) * bins));
        let m = 0;
        for (let b = b0; b < b1 && b < freq.length; b++) m = Math.max(m, freq[b]!);
        // Treble carries less energy in music: tilt it up a little so the high end is not always flat.
        return Math.min(1, (m / 255) * (0.92 + (i / count) * 0.3));
      },
      ring: (i, count) => { const half = count / 2, k = Math.floor(i) % count; return f.band(k < half ? k : count - 1 - k, half); },
      lo: { ctx: loCtx, img: loCtx.createImageData(loCanvas.width, loCanvas.height), w: loCanvas.width, h: loCanvas.height, blit: () => { loCtx.putImageData(f.lo.img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(loCanvas, 0, 0, f.w, f.h); } }
    };
    const resize = () => {
      const r = cv.getBoundingClientRect(); f.w = r.width; f.h = r.height;
      scale = Math.min(dpr * q, Math.sqrt(budget / Math.max(1, f.w * f.h)));
      f.dpr = scale;
      cv.width = Math.max(1, Math.round(f.w * scale)); cv.height = Math.max(1, Math.round(f.h * scale));
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    let bassAvg = 0, beatCool = 0, cycleAt = 0, beatPulse = 0;
    const started = performance.now();
    let lastFrame = started, frameMs = 16, sinceTune = 0;
    let glState: unknown = null;
    const gl = glRenderer();
    const spectrum = new Uint8Array(128);
    let current: Scene | null = null;
    let state: unknown = null;
    // By mood: the words decide when they say something; otherwise how hard the first seconds hit.
    let moodSong = '', moodStart = 0, energy = 0, moodPicked: MoodPick | null = null;
    const pickMood = (): Scene => {
      const { key, mood } = songRef.current;
      if (key !== moodSong) { moodSong = key; moodStart = f.t; energy = 0; moodPicked = null; }
      energy += (f.level - energy) * 0.01;
      const settled = f.t - moodStart > 240;
      const want = mood ?? (settled ? moodFromEnergy(energy) : null);
      if (want && (!moodPicked || moodPicked.mood !== want)) {
        const options = MOOD_SCENES[want]!;
        // The same song always gets the same scene; different songs of one mood vary.
        const hash = [...key].reduce((n, c) => n + c.charCodeAt(0), 0);
        moodPicked = { mood: want, scene: options[hash % options.length]!, byEnergy: !mood };
        onMoodRef.current?.(moodPicked);
      }
      return SCENE_BY_ID.get(moodPicked?.scene ?? current?.id ?? 'fireflies') ?? SCENE_BY_ID.get('fireflies')!;
    };
    const pickScene = (): Scene => {
      if (variant === 'strip') return SCENE_BY_ID.get('bars')!;
      if (scene === 'mood') return variant === 'tile' ? SCENE_BY_ID.get(MOOD_SCENES[MOOD_ORDER[Math.floor(f.t / 300) % MOOD_ORDER.length]!]![0]!)! : pickMood();
      if (scene !== 'cycle') return SCENE_BY_ID.get(scene) ?? SCENE_BY_ID.get('bars')!;
      // Cycle: a new scene every 25 seconds.
      if (!current || f.t - cycleAt > 1500) { cycleAt = f.t; const others = SCENE_LIST.filter(sc => sc !== current); return others[Math.floor(Math.random() * others.length)]!; }
      return current;
    };
    let hidden = document.hidden;
    const onVis = () => { hidden = document.hidden; };
    document.addEventListener('visibilitychange', onVis);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      f.t += 1;
      if (hidden || (variant === 'tile' && f.t % 3)) return;
      // Keep it smooth: measure how long frames take and trade resolution for speed only when needed.
      const now = performance.now();
      frameMs = frameMs * 0.92 + Math.min(100, now - lastFrame) * 0.08;
      lastFrame = now;
      if (variant === 'full' && now - sinceTune > 500) {
        sinceTune = now;
        // Cost grows with the pixel count (q squared): jump straight to the size that fits about 60 frames a second.
        const fit = q * Math.sqrt(16.7 / Math.max(1, frameMs)) * 0.95;
        const next = frameMs > 19 ? Math.max(0.3, fit) : frameMs < 13 && q < 1 ? Math.min(1, q * 1.1) : q;
        if (Math.abs(next - q) > 0.02) { q = next; resize(); frameMs = 16; }
      }
      const an = audioEngine.analyser;
      if (an) { an.getByteFrequencyData(freq); an.getByteTimeDomainData(wave); } else { freq.fill(0); wave.fill(128); }
      let bass = 0; for (let b = 1; b < 8; b++) bass += freq[b]!; f.bass = bass / (7 * 255);
      let mids = 0; for (let b = 20; b < 120; b++) mids += freq[b]!; f.mids = mids / (100 * 255);
      let treble = 0; for (let b = 200; b < 500; b++) treble += freq[b]!; f.treble = Math.min(1, (treble / (300 * 255)) * 1.8);
      f.level = (f.bass + f.mids + f.treble) / 3;
      f.hue = (f.t * 0.2 + f.bass * 70) % 360;
      // A beat: the bass jumps well above its running average.
      bassAvg = bassAvg * 0.95 + f.bass * 0.05;
      f.beat = beatCool <= 0 && f.bass > 0.28 && f.bass > bassAvg * 1.3;
      if (f.beat) beatCool = 14; else beatCool--;
      beatPulse = f.beat ? 1 : beatPulse * 0.9;
      const next = pickScene();
      if (next !== current) {
        current = next;
        state = next.setup?.(f) ?? null;
        glState = next.gl?.setup?.() ?? null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, f.w, f.h);
      }
      if (next.gl && gl) {
        for (let i = 0; i < 128; i++) spectrum[i] = Math.round(f.band(i, 128) * 255);
        const res = next.gl.resolution ?? 1;
        const bw = Math.max(1, Math.round(cv.width * res)), bh = Math.max(1, Math.round(cv.height * res));
        const ok = gl.render(next.gl, glState, {
          width: bw, height: bh, time: (now - started) / 1000, bass: f.bass, mids: f.mids, treble: f.treble, level: f.level, beat: beatPulse,
          hue: f.hue, tint: f.tint, spectrum, aa: res === 1 && bw * bh < 500_000 && frameMs < 13 ? 2 : 1
        });
        if (ok) { blitGl(ctx, bw, bh, f.w, f.h); return; }
      }
      next.draw(f, state as never);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); onMoodRef.current?.(null); };
  }, [scene, tint, variant]);

  return <canvas ref={canvas} className={`viz-canvas${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}

/** Sung lyrics over a visualizer: the line being sung fills in (karaoke), or lines roll up. */
export function LyricsOverlay({ line, style, size = 'md', state }: { line: LyricLine; style: LyricStyle; size?: 'md' | 'lg'; state?: 'loading' | 'none' | 'ok' }) {
  if (style === 'off') return null;
  if (state === 'none') return <p className="viz-note">No timed lyrics for this song.</p>;
  if (!line.now && !line.next) return null;
  return (
    <div className={`viz-lyrics viz-lyrics--${style} viz-lyrics--${size}`} aria-live="off">
      {style === 'roll' && <p className="viz-line viz-line--dim">{line.prev}</p>}
      <p key={line.now} className="viz-line viz-line--now" style={{ ['--p' as string]: line.progress }}>{line.now || '♪'}</p>
      <p className="viz-line viz-line--dim">{line.next}</p>
    </div>
  );
}

/** Live previews of each scene, to pick one by sight. */
export function SceneTiles({ tint, compact }: { tint?: string; compact?: boolean }) {
  const { scene } = useViz();
  return (
    <div className={`viz-tiles${compact ? ' viz-tiles--compact' : ''}`} role="radiogroup" aria-label="Visualization">
      {SCENES.map(sc => (
        <button key={sc.id} type="button" role="radio" aria-checked={scene === sc.id} className={`viz-tile${scene === sc.id ? ' is-on' : ''}`} onClick={() => setViz({ scene: sc.id })} title={sc.name}>
          {sc.id === 'cycle'
            ? <span className="viz-tile-cycle" aria-hidden="true">↻</span>
            : <VizCanvas scene={sc.id} tint={tint} variant="tile" className="viz-tile-canvas" />}
          <span className="viz-tile-name">{sc.name}</span>
        </button>
      ))}
    </div>
  );
}

export function LyricStyleToggle() {
  const { lyricStyle } = useViz();
  const options: [LyricStyle, string][] = [['karaoke', 'Karaoke'], ['roll', 'Rolling'], ['off', 'Off']];
  return (
    <div className="seg" role="radiogroup" aria-label="Lyrics on the visualizer">
      <span className="seg-label">Lyrics</span>
      {options.map(([id, label]) => (
        <button key={id} type="button" role="radio" aria-checked={lyricStyle === id} className={`seg-btn${lyricStyle === id ? ' is-on' : ''}`} onClick={() => setViz({ lyricStyle: id })}>{label}</button>
      ))}
    </div>
  );
}
