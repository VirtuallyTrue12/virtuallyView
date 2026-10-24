import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../../lib/audio-engine';
import { api, type Lyrics } from '../../lib/api';

/**
 * Music visualizations in the spirit of the classic desktop media players: bars, a drifting mist, a mirrored
 * "alchemy" kaleidoscope, a radial tunnel and an oscilloscope. All original drawings on one canvas, fed by the
 * player's analyser, so they move with what is actually playing (including the equalizer).
 */
export const SCENES = [
  { id: 'bars', name: 'Bars and peaks' },
  { id: 'mist', name: 'Ocean mist' },
  { id: 'alchemy', name: 'Alchemy' },
  { id: 'tunnel', name: 'Tunnel' },
  { id: 'scope', name: 'Scope' },
  { id: 'cycle', name: 'Cycle all' }
] as const;
export type SceneId = typeof SCENES[number]['id'];
export type LyricStyle = 'off' | 'karaoke' | 'roll';

type Props = { scene: SceneId; tint: string; lyricStyle: LyricStyle; getTime: () => number; artist?: string; title: string; album?: string; duration?: number; playing: boolean };

function useSyncedLyrics(artist: string | undefined, title: string, album: string | undefined, duration: number | undefined, on: boolean): Lyrics['synced'] | undefined {
  // undefined while loading, null when there are none.
  const [lines, setLines] = useState<Lyrics['synced'] | undefined>(undefined);
  useEffect(() => {
    setLines(undefined);
    if (!on || !artist || !title) return;
    let alive = true;
    api.lyrics(artist, title, album, duration).then(l => { if (alive) setLines(l?.synced ?? null); }).catch(() => { if (alive) setLines(null); });
    return () => { alive = false; };
  }, [artist, title, album, duration, on]);
  return lines;
}

export default function Visualizer({ scene, tint, lyricStyle, getTime, artist, title, album, duration, playing }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [line, setLine] = useState<{ now: string; next: string; prev: string; progress: number }>({ now: '', next: '', prev: '', progress: 0 });
  const lyrics = useSyncedLyrics(artist, title, album, duration, lyricStyle !== 'off');

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    let raf = 0;
    let w = 0, h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { const r = cv.getBoundingClientRect(); w = r.width; h = r.height; cv.width = Math.max(1, w * dpr); cv.height = Math.max(1, h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    const freq = new Uint8Array(1024);
    const wave = new Uint8Array(2048);
    const peaks = new Float32Array(96);
    const particles = Array.from({ length: 140 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), v: 0.002 + Math.random() * 0.006, s: 1 + Math.random() * 2.5 }));
    const [tr, tg, tb] = tint.split(',').map(n => Number(n.trim()) || 128);
    let t = 0;
    let cycleScene: SceneId = 'bars';
    const order: SceneId[] = ['bars', 'mist', 'alchemy', 'tunnel', 'scope'];

    const draw = () => {
      raf = requestAnimationFrame(draw);
      t += 1;
      const an = audioEngine.analyser;
      if (an) { an.getByteFrequencyData(freq); an.getByteTimeDomainData(wave); } else { freq.fill(0); wave.fill(128); }
      const bass = (freq[2]! + freq[3]! + freq[4]! + freq[5]!) / 1020;
      const mids = freq.slice(20, 120).reduce((a, b) => a + b, 0) / (100 * 255);
      const s: SceneId = scene === 'cycle' ? (t % 1800 === 0 ? (cycleScene = order[(order.indexOf(cycleScene) + 1) % order.length]!) : cycleScene) : scene;
      const hue = (t * 0.25 + bass * 80) % 360;

      if (s === 'bars') {
        ctx.fillStyle = 'rgba(6,8,14,0.35)'; ctx.fillRect(0, 0, w, h);
        const n = peaks.length, bw = w / n;
        for (let i = 0; i < n; i++) {
          // Log-spaced bins so the bass is not crammed into two bars.
          // Up to ~10 kHz: compressed music carries little above that, so higher bars sat empty.
          const idx = Math.floor(Math.pow(i / n, 1.7) * 420) + 1;
          const lift = 1 + (i / n) * 0.9; // treble is naturally quieter; lift it so the right side moves too
          const v = Math.min(1, (freq[idx]! / 255) * lift);
          const bh = v * h * 0.85;
          peaks[i] = Math.max(peaks[i]! - h * 0.006, bh);
          const g = ctx.createLinearGradient(0, h, 0, h - bh);
          g.addColorStop(0, `rgba(${tr},${tg},${tb},0.9)`); g.addColorStop(1, `hsla(${(hue + i * 2) % 360},90%,65%,0.95)`);
          ctx.fillStyle = g;
          ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(i * bw + 1, h - peaks[i]! - 3, bw - 2, 2);
        }
      } else if (s === 'mist') {
        ctx.fillStyle = 'rgba(4,10,24,0.18)'; ctx.fillRect(0, 0, w, h);
        for (let layer = 0; layer < 5; layer++) {
          ctx.beginPath();
          const amp = h * (0.06 + bass * 0.25) * (1 - layer * 0.12);
          for (let x = 0; x <= w; x += 6) {
            const k = freq[Math.floor((x / w) * 200) + 4]! / 255;
            const y = h * (0.35 + layer * 0.08) + Math.sin(x * 0.006 + t * 0.012 * (layer + 1)) * amp + Math.sin(x * 0.017 - t * 0.02) * amp * 0.4 * k;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
          ctx.fillStyle = `hsla(${(hue + 180 + layer * 18) % 360},70%,${45 + layer * 5}%,${0.06 + mids * 0.12})`;
          ctx.fill();
        }
      } else if (s === 'alchemy') {
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.48;
        ctx.save(); ctx.translate(cx, cy); ctx.globalCompositeOperation = 'lighter';
        const arms = 8;
        for (const p of particles) {
          p.a += p.v * (1 + bass * 4); p.r += 0.0015 + bass * 0.01; if (p.r > 1) p.r = Math.random() * 0.15;
          for (let k = 0; k < arms; k++) {
            const a = p.a + (k * Math.PI * 2) / arms, rr = p.r * R;
            const x = Math.cos(a) * rr, y = Math.sin(a) * rr * (k % 2 ? 1 : -1);
            ctx.fillStyle = `hsla(${(hue + p.r * 160) % 360},95%,60%,${0.35 * (1 - p.r)})`;
            ctx.beginPath(); ctx.arc(x, y, p.s * (1 + bass * 2), 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore(); ctx.globalCompositeOperation = 'source-over';
      } else if (s === 'tunnel') {
        ctx.fillStyle = 'rgba(2,2,8,0.25)'; ctx.fillRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.45, n = 120;
        for (let ring = 0; ring < 3; ring++) {
          ctx.beginPath();
          for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2 + t * 0.004 * (ring + 1) * (ring % 2 ? -1 : 1);
            const v = freq[(i % (n / 2)) * 3 + 2]! / 255;
            const r = R * (0.35 + ring * 0.22) + v * R * 0.35;
            const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `hsla(${(hue + ring * 60) % 360},90%,62%,0.8)`; ctx.lineWidth = 2 + bass * 4; ctx.stroke();
        }
      } else {
        ctx.fillStyle = 'rgba(0,6,4,0.3)'; ctx.fillRect(0, 0, w, h);
        ctx.beginPath();
        for (let i = 0; i < wave.length; i += 4) {
          const x = (i / wave.length) * w, y = (wave[i]! / 255) * h;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsl(${(hue + 120) % 360},95%,60%)`; ctx.lineWidth = 2.5; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
      }
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [scene, tint]);

  // Lyrics on top: the line being sung, with the next one waiting underneath.
  useEffect(() => {
    if (lyricStyle === 'off' || !lyrics?.length) { setLine({ now: '', next: '', prev: '', progress: 0 }); return; }
    const id = window.setInterval(() => {
      const now = getTime() + 0.25;
      let i = -1;
      for (let k = 0; k < lyrics.length; k++) if (lyrics[k]!.time <= now) i = k; else break;
      const cur = lyrics[i], nxt = lyrics[i + 1];
      const span = cur && nxt ? Math.max(0.5, nxt.time - cur.time) : 4;
      setLine({ prev: lyrics[i - 1]?.text ?? '', now: cur?.text ?? '', next: nxt?.text ?? '', progress: cur ? Math.min(1, (now - cur.time) / span) : 0 });
    }, 120);
    return () => window.clearInterval(id);
  }, [lyrics, lyricStyle, getTime]);

  return (
    <div className={`viz${playing ? '' : ' is-paused'}`}>
      <canvas ref={canvas} className="viz-canvas" aria-hidden="true" />
      {lyricStyle !== 'off' && (line.now || line.next) && (
        <div className={`viz-lyrics viz-lyrics--${lyricStyle}`} aria-live="polite">
          {lyricStyle === 'roll' && line.prev && <p className="viz-line viz-line--dim">{line.prev}</p>}
          <p className="viz-line viz-line--now" style={{ ['--p' as string]: line.progress }}>{line.now}</p>
          {line.next && <p className="viz-line viz-line--dim">{line.next}</p>}
        </div>
      )}
      {lyricStyle !== 'off' && lyrics === null && <p className="viz-note">No synced lyrics for this track.</p>}
    </div>
  );
}
