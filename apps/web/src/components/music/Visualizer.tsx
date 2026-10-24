import { useEffect, useRef } from 'react';
import { audioEngine } from '../../lib/audio-engine';
import { setViz, useViz, type LyricLine, type LyricStyle, type SceneId } from '../../lib/viz-store';

/**
 * Music visualizations in the spirit of the classic desktop media players: bars, a drifting mist, a mirrored
 * "alchemy" kaleidoscope, a radial tunnel and an oscilloscope. All original drawings, fed by the player's analyser,
 * so they move with what is actually playing (equalizer included).
 */
export const SCENES: { id: SceneId; name: string }[] = [
  { id: 'bars', name: 'Bars' },
  { id: 'mist', name: 'Ocean mist' },
  { id: 'alchemy', name: 'Alchemy' },
  { id: 'tunnel', name: 'Tunnel' },
  { id: 'scope', name: 'Scope' },
  { id: 'cycle', name: 'Cycle all' }
];
const ORDER: SceneId[] = ['bars', 'mist', 'alchemy', 'tunnel', 'scope'];

type Variant = 'full' | 'strip' | 'tile';

/**
 * One canvas drawing one scene. `full` fills a stage, `strip` is the thin spectrum on the bottom bar and `tile` is
 * a small live preview in the scene picker.
 */
export function VizCanvas({ scene, tint = '120, 128, 160', variant = 'full', className }: { scene: SceneId; tint?: string; variant?: Variant; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    let raf = 0;
    let w = 0, h = 0;
    const dpr = Math.min(variant === 'full' ? 2 : 1.5, window.devicePixelRatio || 1);
    const resize = () => { const r = cv.getBoundingClientRect(); w = r.width; h = r.height; cv.width = Math.max(1, w * dpr); cv.height = Math.max(1, h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    const freq = new Uint8Array(1024);
    const wave = new Uint8Array(2048);
    const n = variant === 'strip' ? 120 : variant === 'tile' ? 18 : 72;
    const level = new Float32Array(n);
    const peaks = new Float32Array(n);
    const peakVel = new Float32Array(n);
    const particles = Array.from({ length: variant === 'tile' ? 40 : 150 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), v: 0.002 + Math.random() * 0.006, s: 1 + Math.random() * 2.5 }));
    const [tr, tg, tb] = tint.split(',').map(x => Number(x.trim()) || 128);
    let t = 0;
    let cycleScene: SceneId = 'bars';
    let hidden = document.hidden;
    const onVis = () => { hidden = document.hidden; };
    document.addEventListener('visibilitychange', onVis);

    // Bars on a log scale from 35 Hz to 16 kHz, each the loudest bin in its slice, so every bar moves.
    const band = (i: number, count: number): number => {
      const an = audioEngine.analyser;
      const rate = audioEngine.ctx?.sampleRate ?? 48000;
      const bins = an?.frequencyBinCount ?? 1024;
      const f0 = 35 * Math.pow(16000 / 35, i / count), f1 = 35 * Math.pow(16000 / 35, (i + 1) / count);
      const b0 = Math.max(1, Math.floor((f0 / (rate / 2)) * bins)), b1 = Math.max(b0 + 1, Math.ceil((f1 / (rate / 2)) * bins));
      let m = 0;
      for (let b = b0; b < b1 && b < freq.length; b++) m = Math.max(m, freq[b]!);
      // Treble carries less energy in music: tilt it up a little so the right side is not always flat.
      return Math.min(1, (m / 255) * (0.92 + (i / count) * 0.3));
    };

    const roundTop = (x: number, y: number, bw: number, bh: number) => {
      const r = Math.min(bw / 2, 4, bh);
      ctx.beginPath();
      ctx.moveTo(x, y + bh); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.lineTo(x + bw - r, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + r); ctx.lineTo(x + bw, y + bh); ctx.closePath();
      ctx.fill();
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += 1;
      if (hidden || (variant === 'tile' && t % 2)) return;
      const an = audioEngine.analyser;
      if (an) { an.getByteFrequencyData(freq); an.getByteTimeDomainData(wave); } else { freq.fill(0); wave.fill(128); }
      let bass = 0; for (let b = 1; b < 8; b++) bass += freq[b]!; bass /= 7 * 255;
      let mids = 0; for (let b = 20; b < 120; b++) mids += freq[b]!; mids /= 100 * 255;
      if (scene === 'cycle' && t % 1500 === 0) cycleScene = ORDER[(ORDER.indexOf(cycleScene) + 1) % ORDER.length]!;
      const s: SceneId = scene === 'cycle' ? cycleScene : scene;
      const hue = (t * 0.2 + bass * 70) % 360;

      if (variant === 'strip' || s === 'bars') {
        const strip = variant === 'strip';
        ctx.clearRect(0, 0, w, h);
        if (!strip) { const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, 'rgba(8,10,18,1)'); bg.addColorStop(1, `rgba(${tr},${tg},${tb},0.16)`); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
        const floor = strip ? h : h * (variant === 'tile' ? 0.92 : 0.8);
        const room = strip ? h : floor * 0.9;
        const gap = strip ? 1 : variant === 'tile' ? 2 : 3;
        const bw = Math.max(1, w / n - gap);
        for (let i = 0; i < n; i++) {
          const target = band(i, n);
          // Fast attack, slower fall: the motion reads as music rather than flicker.
          level[i] = target > level[i]! ? level[i]! + (target - level[i]!) * 0.6 : level[i]! * 0.9;
          const bh = Math.max(strip ? 0 : 2, level[i]! * room);
          if (bh >= peaks[i]!) { peaks[i] = bh; peakVel[i] = 0; } else { peakVel[i]! += 0.25; peaks[i] = Math.max(0, peaks[i]! - peakVel[i]! * 0.35); }
          const x = i * (bw + gap) + gap / 2;
          const g = ctx.createLinearGradient(0, floor, 0, floor - room);
          g.addColorStop(0, `rgba(${tr},${tg},${tb},0.95)`);
          g.addColorStop(0.55, `hsla(${(hue + i * 1.6) % 360},85%,62%,0.95)`);
          g.addColorStop(1, `hsla(${(hue + 60 + i * 1.6) % 360},95%,75%,1)`);
          ctx.fillStyle = g;
          if (strip) { ctx.globalAlpha = 0.85; ctx.fillRect(x, floor - bh, bw, bh); ctx.globalAlpha = 1; continue; }
          roundTop(x, floor - bh, bw, bh);
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(x, floor - peaks[i]! - 4, bw, 2);
          if (variant === 'full') {
            // A soft reflection on the floor.
            ctx.globalAlpha = 0.18; ctx.fillStyle = g; ctx.fillRect(x, floor + 2, bw, Math.min(h - floor - 2, bh * 0.35)); ctx.globalAlpha = 1;
          }
        }
      } else if (s === 'mist') {
        ctx.fillStyle = 'rgba(4,10,24,0.16)'; ctx.fillRect(0, 0, w, h);
        for (let layer = 0; layer < 5; layer++) {
          ctx.beginPath();
          const amp = h * (0.05 + bass * 0.28) * (1 - layer * 0.12);
          for (let x = 0; x <= w; x += Math.max(3, w / 160)) {
            const k = freq[Math.floor((x / w) * 220) + 3]! / 255;
            const y = h * (0.34 + layer * 0.09) + Math.sin(x * (6 / w) + t * 0.012 * (layer + 1)) * amp + Math.sin(x * (17 / w) - t * 0.02) * amp * 0.5 * k;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
          ctx.fillStyle = `hsla(${(hue + 180 + layer * 18) % 360},70%,${45 + layer * 5}%,${0.07 + mids * 0.16})`;
          ctx.fill();
        }
      } else if (s === 'alchemy') {
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, w, h);
        const R = Math.min(w, h) * 0.5;
        ctx.save(); ctx.translate(w / 2, h / 2); ctx.globalCompositeOperation = 'lighter';
        const arms = 8;
        for (const p of particles) {
          p.a += p.v * (1 + bass * 4); p.r += 0.0015 + bass * 0.012; if (p.r > 1) p.r = Math.random() * 0.15;
          for (let k = 0; k < arms; k++) {
            const a = p.a + (k * Math.PI * 2) / arms, rr = p.r * R;
            ctx.fillStyle = `hsla(${(hue + p.r * 160) % 360},95%,60%,${0.35 * (1 - p.r)})`;
            ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * (k % 2 ? 1 : -1), p.s * (1 + bass * 2) * (variant === 'tile' ? 0.5 : 1), 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore(); ctx.globalCompositeOperation = 'source-over';
      } else if (s === 'tunnel') {
        ctx.fillStyle = 'rgba(2,2,8,0.22)'; ctx.fillRect(0, 0, w, h);
        const R = Math.min(w, h) * 0.45, pts = 120;
        for (let ring = 0; ring < 3; ring++) {
          ctx.beginPath();
          for (let i = 0; i <= pts; i++) {
            const a = (i / pts) * Math.PI * 2 + t * 0.004 * (ring + 1) * (ring % 2 ? -1 : 1);
            const v = band(i % (pts / 2), pts / 2);
            const r = R * (0.32 + ring * 0.22) + v * R * 0.35;
            const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `hsla(${(hue + ring * 60) % 360},90%,62%,0.85)`; ctx.lineWidth = (variant === 'tile' ? 1 : 2) + bass * 4; ctx.stroke();
        }
      } else {
        ctx.fillStyle = 'rgba(0,6,4,0.3)'; ctx.fillRect(0, 0, w, h);
        ctx.beginPath();
        for (let i = 0; i < wave.length; i += 4) {
          const x = (i / wave.length) * w, y = h / 2 + ((wave[i]! - 128) / 128) * h * 0.45;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsl(${(hue + 120) % 360},95%,60%)`; ctx.lineWidth = variant === 'tile' ? 1.5 : 2.5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = variant === 'tile' ? 0 : 14; ctx.stroke(); ctx.shadowBlur = 0;
      }
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
