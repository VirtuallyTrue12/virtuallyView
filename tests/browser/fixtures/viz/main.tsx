import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { audioEngine } from '../../../../apps/web/src/lib/audio-engine';
import { VizCanvas } from '../../../../apps/web/src/components/music/Visualizer';
import { SCENE_LIST } from '../../../../apps/web/src/components/music/viz-scenes';

/**
 * A page with one full-screen visualizer fed by a real AnalyserNode playing eight seconds of made-up music
 * (kick, bass line, chords, hi-hats) on a loop, for the scene browser test and .dev/viz-bench.
 */
function music(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate, len = rate * 8, buf = ctx.createBuffer(1, len, rate), d = buf.getChannelData(0);
  const beat = rate / 2; // 120 bpm
  const roots = [55, 43.65, 49, 41.2];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < len; i++) {
    const t = i / rate, inBeat = (i % beat) / rate, bar = Math.floor(i / (beat * 4)) % 4;
    const kick = Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-inBeat * 30)) * inBeat) * Math.exp(-inBeat * 8);
    const root = roots[bar]!;
    const bass = Math.sin(2 * Math.PI * root * 2 * t) * 0.35 * (0.6 + 0.4 * Math.exp(-((i % (beat / 2)) / rate) * 6));
    const chord = [4, 5, 6].reduce((s, k) => s + Math.sin(2 * Math.PI * root * k * 2 * t), 0) * 0.08;
    const offBeat = ((i + beat / 2) % beat) / rate;
    const hat = rnd() * Math.exp(-offBeat * 60) * 0.25;
    d[i] = (kick * 0.8 + bass + chord + hat) * 0.6;
  }
  return buf;
}

const ctx = new AudioContext();
const src = ctx.createBufferSource();
src.buffer = music(ctx); src.loop = true;
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8; analyser.minDecibels = -90; analyser.maxDecibels = -12;
const mute = ctx.createGain(); mute.gain.value = 0;
src.connect(analyser); analyser.connect(mute); mute.connect(ctx.destination);
src.start();
Object.assign(audioEngine, { ctx, analyser });

declare global { interface Window { vizScene: (id: string) => void; vizScenes: string[] } }
window.vizScenes = SCENE_LIST.map(s => s.id);

function App() {
  const [scene, setScene] = useState(new URLSearchParams(location.search).get('scene') ?? 'bars');
  const [tint] = useState(new URLSearchParams(location.search).get('tint') ?? '196, 92, 64');
  window.vizScene = setScene;
  return <div className="stage" data-scene={scene}><VizCanvas key={scene} scene={scene} tint={tint} className="vstage-canvas" stage /></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
