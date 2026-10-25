import { useEffect, useRef } from 'react';
import { audioEngine } from '../../lib/audio-engine';
import { setViz, useViz, type LyricLine, type LyricStyle, type SceneId } from '../../lib/viz-store';
import { SCENE_BY_ID, SCENE_LIST, type Frame, type Scene, type Variant } from './viz-scenes';

/**
 * Music visualizations in the spirit of the classic desktop media players: bars, a drifting mist, a mirrored
 * "alchemy" kaleidoscope, a radial tunnel and an oscilloscope. All original drawings, fed by the player's analyser,
 * so they move with what is actually playing (equalizer included).
 */
export const SCENES: { id: SceneId; name: string }[] = [...SCENE_LIST.map(sc => ({ id: sc.id, name: sc.name })), { id: 'cycle', name: 'Cycle all' }];

/**
 * One canvas drawing one scene (see viz-scenes). `full` fills a stage, `strip` is the thin spectrum on the bottom
 * bar and `tile` is a small live preview in the scene picker.
 */
export function VizCanvas({ scene, tint = '120, 128, 160', variant = 'full', className }: { scene: SceneId; tint?: string; variant?: Variant; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    let raf = 0;
    const dpr = Math.min(variant === 'full' ? 2 : 1.5, window.devicePixelRatio || 1);
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
    const resize = () => { const r = cv.getBoundingClientRect(); f.w = r.width; f.h = r.height; cv.width = Math.max(1, f.w * dpr); cv.height = Math.max(1, f.h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    let bassAvg = 0, beatCool = 0, cycleAt = 0;
    let current: Scene | null = null;
    let state: unknown = null;
    const pickScene = (): Scene => {
      if (variant === 'strip') return SCENE_BY_ID.get('bars')!;
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
      if (hidden || (variant === 'tile' && f.t % 2)) return;
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
      const next = pickScene();
      if (next !== current) {
        current = next;
        state = next.setup?.(f) ?? null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, f.w, f.h);
      }
      next.draw(f, state as never);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); };
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
