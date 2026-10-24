import { useEffect, useRef, useState } from 'react';
import { EQ_BANDS, EQ_PRESETS, useMusicPlayer, type QueueEntry, type RepeatMode } from '../media/MusicProvider';
import { audioEngine, speak, djLine } from '../../lib/audio-engine';
import Visualizer, { SCENES, type LyricStyle, type SceneId } from './Visualizer';
import { SvgIcon } from '../ui/SvgIcon';
import LyricsPanel from '../media/LyricsPanel';
import { SeekBar, formatClock } from './SeekBar';

const DEFAULT_TINT = '120, 128, 160';
const tints = new Map<string, string>();

/** The main colour of the artwork as "r, g, b", for the glow behind the Now Playing view. Falls back quietly. */
function useArtworkTint(src?: string): string {
  const [tint, setTint] = useState(() => (src ? tints.get(src) : undefined) ?? DEFAULT_TINT);
  useEffect(() => {
    if (!src) { setTint(DEFAULT_TINT); return; }
    const known = tints.get(src);
    if (known) { setTint(known); return; }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      try {
        const size = 12;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0, g = 0, b = 0, weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const R = data[i]!, G = data[i + 1]!, B = data[i + 2]!;
          const max = Math.max(R, G, B), min = Math.min(R, G, B);
          const luma = (R + G + B) / 3;
          if (luma < 28 || luma > 232) continue; // near black or white says nothing about the picture
          const w = 0.15 + (max === 0 ? 0 : (max - min) / max);
          r += R * w; g += G * w; b += B * w; weight += w;
        }
        if (weight > 0) {
          const value = `${Math.round(r / weight)}, ${Math.round(g / weight)}, ${Math.round(b / weight)}`;
          tints.set(src, value);
          if (!cancelled) setTint(value);
        }
      } catch { /* a picture the canvas cannot read: keep the neutral glow */ }
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return tint;
}

function Cover({ src, label, className }: { src?: string; label: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={`mp-cover${className ? ` ${className}` : ''}`}>
      {src && !failed
        ? <img key={src} className="mp-cover-img" src={src} alt={label} onError={() => setFailed(true)} />
        : <span className="mp-cover-empty" aria-hidden="true"><SvgIcon name="music-note" size={28} /></span>}
    </div>
  );
}

const repeatLabel: Record<RepeatMode, string> = { off: 'Repeat: off', all: 'Repeat: all tracks', one: 'Repeat: this track' };

function Transport({ large }: { large?: boolean }) {
  const { playing, buffering, shuffle, repeat, toggle, nextTrack, prevTrack, toggleShuffle, toggleRepeat } = useMusicPlayer();
  const icon = large ? 22 : 18;
  return (
    <div className={`mp-transport${large ? ' mp-transport--large' : ''}`}>
      <button type="button" className={`mp-icon mp-icon--optional${shuffle ? ' is-on' : ''}`} onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle} title="Shuffle"><SvgIcon name="shuffle" size={icon} /></button>
      <button type="button" className="mp-icon" onClick={prevTrack} aria-label="Previous track" title="Previous"><SvgIcon name="prev" size={icon} /></button>
      <button type="button" className={`mp-play${buffering && playing ? ' is-buffering' : ''}`} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>
        <SvgIcon name={playing ? 'pause' : 'play'} size={large ? 26 : 20} />
      </button>
      <button type="button" className="mp-icon" onClick={nextTrack} aria-label="Next track" title="Next"><SvgIcon name="next" size={icon} /></button>
      <button type="button" className={`mp-icon mp-icon--optional${repeat !== 'off' ? ' is-on' : ''}`} onClick={toggleRepeat} aria-label={repeatLabel[repeat]} aria-pressed={repeat !== 'off'} title={repeatLabel[repeat]}>
        <SvgIcon name={repeat === 'one' ? 'repeat-one' : 'repeat'} size={icon} />
      </button>
    </div>
  );
}

function Volume() {
  const { volume, muted, setVolume, toggleMute } = useMusicPlayer();
  const level = muted ? 0 : volume;
  return (
    <div className="mp-volume">
      <button type="button" className="mp-icon" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
        <SvgIcon name={level === 0 ? 'volume-mute' : level < 0.5 ? 'volume-low' : 'volume-high'} size={18} />
      </button>
      <input className="mp-range" type="range" min={0} max={1} step={0.02} value={level} style={{ ['--v' as string]: level }}
        onChange={e => setVolume(Number(e.target.value))} aria-label="Volume" />
    </div>
  );
}

function Progress({ times }: { times: 'sides' | 'none' }) {
  const { getTime, duration, buffered, playing, seek, entry } = useMusicPlayer();
  const length = duration > 0 && Number.isFinite(duration) ? duration : entry?.track.durationMs ? entry.track.durationMs / 1000 : 0;
  return <SeekBar getTime={getTime} duration={length} buffered={buffered} playing={playing} onSeek={seek} times={times} size={times === 'none' ? 'slim' : 'regular'} label="Seek" />;
}

function QueuePanel() {
  const { queue, index, playing, skipTo, removeFromQueue, clearUpcoming } = useMusicPlayer();
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [index]);
  const upcoming = queue.length - index - 1;
  return (
    <div className="mp-queue">
      <div className="mp-queue-head">
        <span>{queue.length} {queue.length === 1 ? 'track' : 'tracks'}{upcoming > 0 ? ` · ${upcoming} up next` : ''}</span>
        {upcoming > 0 && <button type="button" className="mp-link" onClick={clearUpcoming}>Clear up next</button>}
      </div>
      <ol className="mp-queue-list">
        {queue.map((q: QueueEntry, i) => (
          <li key={`${q.track.id}-${i}`} ref={i === index ? activeRef : undefined} className={`mp-queue-row${i === index ? ' is-active' : ''}`}>
            <button type="button" className="mp-queue-main" onClick={() => skipTo(i)} aria-current={i === index ? 'true' : undefined}>
              <span className="mp-queue-num">{i === index ? <SvgIcon name={playing ? 'pause' : 'play'} size={12} /> : i + 1}</span>
              <span className="mp-queue-text">
                <span className="mp-queue-title">{q.track.title}</span>
                <span className="mp-queue-sub">{[q.artistTitle, q.albumTitle].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="mp-queue-dur">{q.track.durationMs ? formatClock(q.track.durationMs / 1000) : ''}</span>
            </button>
            <button type="button" className="mp-icon mp-queue-remove" onClick={() => removeFromQueue(i)} aria-label={`Remove ${q.track.title} from the queue`} title="Remove"><SvgIcon name="close" size={14} /></button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The EQ's combined response drawn as a curve over the live spectrum, so a change is visible as well as audible. */
function EqCurve() {
  const { eqBands, eqEnabled, preamp } = useMusicPlayer();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    let raf = 0;
    const N = 160;
    const freqs = new Float32Array(N);
    for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1));
    const spec = new Uint8Array(1024);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const an = audioEngine.analyser;
      const rate = audioEngine.ctx?.sampleRate ?? 48000;
      if (an) {
        an.getByteFrequencyData(spec);
        ctx.fillStyle = 'rgba(212,162,78,0.18)';
        for (let i = 0; i < N; i++) {
          const bin = Math.min(spec.length - 1, Math.round((freqs[i]! / (rate / 2)) * an.frequencyBinCount));
          const v = (spec[bin] ?? 0) / 255;
          ctx.fillRect((i / N) * w, h - v * h, w / N + 0.5, v * h);
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
      for (const db of [-12, -6, 0, 6, 12]) { const y = h / 2 - (db / 15) * (h / 2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      const resp = audioEngine.ready ? audioEngine.response(freqs) : new Float32Array(N);
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const db = eqEnabled ? resp[i]! + preamp : 0;
        const x = (i / (N - 1)) * w, y = h / 2 - (Math.max(-15, Math.min(15, db)) / 15) * (h / 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = eqEnabled ? '#d4a24e' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2.5; ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [eqBands, eqEnabled, preamp]);
  return <canvas ref={ref} className="eq-curve" aria-hidden="true" />;
}

function EqualizerPanel() {
  const { eqEnabled, eqPreset, eqBands, preamp, balance, leveller, customPresets, setEqEnabled, setEqPreset, setEqBand, setPreamp, setBalance, setLeveller, saveCustomPreset, deleteCustomPreset } = useMusicPlayer();
  const [naming, setNaming] = useState<string | null>(null);
  const fmt = (n: number) => `${n > 0 ? '+' : ''}${n} dB`;
  const customKey = eqPreset.startsWith('custom:') ? eqPreset.slice(7) : null;
  return (
    <div className={`eq2${eqEnabled ? '' : ' is-off'}`}>
      <div className="eq2-head">
        <label className="eq2-switch">
          <input type="checkbox" checked={eqEnabled} onChange={e => setEqEnabled(e.target.checked)} />
          <span>{eqEnabled ? 'Equalizer on' : 'Equalizer off'}</span>
        </label>
        <select className="eq2-preset" value={EQ_PRESETS[eqPreset] || customKey ? eqPreset : 'custom'} onChange={e => { setEqEnabled(true); setEqPreset(e.target.value); }} aria-label="Preset">
          {eqPreset === 'custom' && <option value="custom">Custom (unsaved)</option>}
          <optgroup label="Presets">{Object.entries(EQ_PRESETS).map(([key, p]) => <option key={key} value={key}>{p.name}</option>)}</optgroup>
          {customPresets.length > 0 && <optgroup label="Yours">{customPresets.map(p => <option key={p.name} value={`custom:${p.name}`}>{p.name}</option>)}</optgroup>}
        </select>
        {naming === null
          ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNaming('')}>Save as…</button>
          : <form className="eq2-save" onSubmit={e => { e.preventDefault(); saveCustomPreset(naming); setNaming(null); }}>
              <input autoFocus value={naming} onChange={e => setNaming(e.target.value)} placeholder="Preset name" maxLength={30} aria-label="Preset name" />
              <button type="submit" className="btn btn-primary btn-sm" disabled={!naming.trim()}>Save</button>
            </form>}
        {customKey && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { deleteCustomPreset(customKey); setEqPreset('flat'); }}>Delete</button>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEqPreset('flat'); setPreamp(0); setBalance(0); }}>Reset</button>
      </div>
      <EqCurve />
      <div className="eq2-bands" onDoubleClick={e => { const i = Number((e.target as HTMLElement).dataset.band); if (Number.isInteger(i)) setEqBand(i, 0); }}>
        <label className="eq2-band eq2-band--pre">
          <span className="eq2-gain">{fmt(preamp)}</span>
          <input type="range" min={-12} max={12} step={0.5} value={preamp} onChange={e => { setEqEnabled(true); setPreamp(Number(e.target.value)); }} aria-label="Preamp" />
          <span className="eq2-label">Pre</span>
        </label>
        {EQ_BANDS.map((band, i) => (
          <label key={band.label} className="eq2-band" title="Double-click to reset">
            <span className="eq2-gain">{fmt(eqBands[i] ?? 0)}</span>
            <input data-band={i} type="range" min={-12} max={12} step={0.5} value={eqBands[i] ?? 0} onChange={e => { setEqEnabled(true); setEqBand(i, Number(e.target.value)); }} aria-label={`${band.label} Hz`} />
            <span className="eq2-label">{band.label}</span>
          </label>
        ))}
      </div>
      <div className="eq2-extra">
        <label className="eq2-row">
          <span>Balance</span>
          <input type="range" min={-1} max={1} step={0.05} value={balance} onChange={e => { setEqEnabled(true); setBalance(Number(e.target.value)); }} aria-label="Balance" />
          <span className="eq2-val">{balance === 0 ? 'Centre' : balance < 0 ? `L ${Math.round(-balance * 100)}` : `R ${Math.round(balance * 100)}`}</span>
        </label>
        <label className="eq2-row eq2-row--check">
          <input type="checkbox" checked={leveller} onChange={e => { setEqEnabled(true); setLeveller(e.target.checked); }} />
          <span>Even out volume (quiet and loud tracks play at a similar level)</span>
        </label>
      </div>
    </div>
  );
}

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)));
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  return voices;
}

function MixPanel() {
  const { crossfade, djMode, djVoice, entry, setCrossfade, setDjMode, setDjVoice } = useMusicPlayer();
  const voices = useVoices();
  return (
    <div className="mix">
      <label className="eq2-row">
        <span>Crossfade</span>
        <input type="range" min={0} max={12} step={1} value={crossfade} onChange={e => setCrossfade(Number(e.target.value))} aria-label="Crossfade seconds" />
        <span className="eq2-val">{crossfade ? `${crossfade} s` : 'Off'}</span>
      </label>
      <p className="mix-help">The end of one track fades into the start of the next, with no gap.</p>
      <label className="eq2-row eq2-row--check">
        <input type="checkbox" checked={djMode} onChange={e => setDjMode(e.target.checked)} />
        <span><strong>DJ mode</strong>: a voice introduces the next track over a smooth fade (works great with Shuffle).</span>
      </label>
      {djMode && (
        <div className="mix-voice">
          {voices.length > 0
            ? <select value={djVoice} onChange={e => setDjVoice(e.target.value)} aria-label="DJ voice">
                <option value="">Automatic voice</option>
                {voices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            : <span className="mix-help">This browser has no voices; the fades still work.</span>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void speak(djLine(null, { title: entry?.track.title ?? 'your music', artist: entry?.artistTitle }), djVoice)}>Test voice</button>
        </div>
      )}
    </div>
  );
}

const loadPref = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const savePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

type Tab = 'queue' | 'lyrics' | 'eq' | 'mix';

function NowPlaying() {
  const { entry, expanded, setExpanded, currentTime, duration, error, stopPlayback, getTime, playing, djTalking } = useMusicPlayer();
  const [tab, setTab] = useState<Tab>('queue');
  const [viz, setViz] = useState(() => loadPref('vv-viz-on', '0') === '1');
  const [scene, setScene] = useState<SceneId>(() => loadPref('vv-viz-scene', 'bars') as SceneId);
  const [lyricStyle, setLyricStyle] = useState<LyricStyle>(() => loadPref('vv-viz-lyrics', 'karaoke') as LyricStyle);
  const [vizFull, setVizFull] = useState(false);
  useEffect(() => savePref('vv-viz-on', viz ? '1' : '0'), [viz]);
  useEffect(() => savePref('vv-viz-scene', scene), [scene]);
  useEffect(() => savePref('vv-viz-lyrics', lyricStyle), [lyricStyle]);
  const tint = useArtworkTint(entry?.cover);
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  // Open: remember where focus was and move into the view. Close: hand focus back.
  useEffect(() => {
    if (expanded) {
      returnTo.current = document.activeElement;
      sheetRef.current?.focus({ preventScroll: true });
    } else if (returnTo.current instanceof HTMLElement) {
      returnTo.current.focus({ preventScroll: true });
      returnTo.current = null;
    }
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, setExpanded]);

  if (!entry) return null;
  return (
    <div ref={sheetRef} tabIndex={-1} className={`np${expanded ? ' is-open' : ''}`} role="dialog" aria-label="Now playing" aria-hidden={!expanded} style={{ ['--np-tint' as string]: tint }}>
      <div className="np-glow" aria-hidden="true" />
      <div className="np-inner">
        <header className="np-top">
          <button type="button" className="mp-icon np-collapse" onClick={() => setExpanded(false)} aria-label="Close Now Playing" tabIndex={expanded ? 0 : -1}><SvgIcon name="chevron-down" size={22} /></button>
          <span className="np-top-title">Now playing</span>
          <button type="button" className="mp-icon np-collapse" onClick={stopPlayback} aria-label="Stop and close player" title="Stop and close" tabIndex={expanded ? 0 : -1}><SvgIcon name="close" size={18} /></button>
        </header>

        <div className="np-body">
          <div className={`np-art${viz ? ' is-viz' : ''}${vizFull ? ' is-full' : ''}`}>
            {viz && expanded
              ? <Visualizer scene={scene} tint={tint} lyricStyle={lyricStyle} getTime={getTime} artist={entry.artistTitle} title={entry.track.title} album={entry.albumTitle} duration={entry.track.durationMs ? entry.track.durationMs / 1000 : (duration || undefined)} playing={playing} />
              : <Cover src={entry.cover} label={`${entry.albumTitle ?? entry.track.title} cover`} className="mp-cover--large" />}
            {djTalking && <span className="np-dj" role="status"><SvgIcon name="music-note" size={14} /> DJ</span>}
            <div className="np-viz-bar">
              <button type="button" className={`np-chip${viz ? ' is-on' : ''}`} onClick={() => setViz(v => !v)} tabIndex={expanded ? 0 : -1}>{viz ? 'Cover art' : 'Visualizer'}</button>
              {viz && <>
                <select className="np-chip" value={scene} onChange={e => setScene(e.target.value as SceneId)} aria-label="Visualization" tabIndex={expanded ? 0 : -1}>
                  {SCENES.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                </select>
                <select className="np-chip" value={lyricStyle} onChange={e => setLyricStyle(e.target.value as LyricStyle)} aria-label="Lyrics on the visualizer" tabIndex={expanded ? 0 : -1}>
                  <option value="karaoke">Lyrics: karaoke</option>
                  <option value="roll">Lyrics: rolling</option>
                  <option value="off">Lyrics: off</option>
                </select>
                <button type="button" className="np-chip" onClick={() => setVizFull(f => !f)} tabIndex={expanded ? 0 : -1}>{vizFull ? 'Exit full view' : 'Full view'}</button>
              </>}
            </div>
          </div>

          <div className="np-main">
            <div className="np-meta">
              <h2 className="np-title" title={entry.track.title}>{entry.track.title}</h2>
              <p className="np-sub">{[entry.artistTitle, entry.albumTitle].filter(Boolean).join(' · ')}</p>
              {entry.track.quality && <span className="np-quality">{entry.track.quality}</span>}
              {error && <p className="np-error" role="alert">{error}</p>}
            </div>
            {expanded && <Progress times="sides" />}
            <Transport large />
            <Volume />
          </div>

          <div className="np-panel">
            <div className="np-tabs" role="tablist" aria-label="Now playing sections">
              {([['queue', 'Up next'], ['lyrics', 'Lyrics'], ['eq', 'Equalizer'], ['mix', 'Mix & DJ']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={`np-tab${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)} tabIndex={expanded ? 0 : -1}>{label}</button>
              ))}
            </div>
            <div className="np-panel-body" role="tabpanel">
              {expanded && tab === 'queue' && <QueuePanel />}
              {expanded && tab === 'lyrics' && (
                <LyricsPanel artist={entry.artistTitle} title={entry.track.title} album={entry.albumTitle} durationSeconds={entry.track.durationMs ? entry.track.durationMs / 1000 : (duration || undefined)} currentTime={currentTime} />
              )}
              {expanded && tab === 'eq' && <EqualizerPanel />}
              {expanded && tab === 'mix' && <MixPanel />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The always-there bar at the bottom, and the full Now Playing view it opens. */
export default function MusicPlayerUI() {
  const { entry, error, expanded, setExpanded, stopPlayback } = useMusicPlayer();
  const bar = useRef<HTMLDivElement>(null);
  // Floating helpers (the assistant, the requests badge) read this to sit above the bar, not on top of it.
  useEffect(() => {
    const root = document.documentElement;
    const el = bar.current;
    if (!el || !entry) { root.style.removeProperty('--dock-bottom'); return; }
    // How far up from the bottom the bar's top edge is: the tab bar on phones counts too.
    const update = () => root.style.setProperty('--dock-bottom', `${expanded ? 0 : Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top))}px`);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); root.style.removeProperty('--dock-bottom'); };
  }, [entry, expanded]);
  if (!entry) return null;
  return (
    <>
      <NowPlaying />
      <div ref={bar} className={`mp${expanded ? ' is-hidden' : ''}`} role="region" aria-label="Music player">
        <div className="mp-edge"><Progress times="none" /></div>
        <div className="mp-row">
          <button type="button" className="mp-now" onClick={() => setExpanded(true)} aria-label="Open Now Playing" title="Open Now Playing" tabIndex={expanded ? -1 : 0}>
            <Cover src={entry.cover} label="" className="mp-cover--mini" />
            <span className="mp-now-text">
              <span className="mp-now-title">{entry.track.title}</span>
              <span className="mp-now-sub">{error ?? [entry.artistTitle, entry.albumTitle].filter(Boolean).join(' · ')}</span>
            </span>
          </button>

          <div className="mp-center">
            <Transport />
            <div className="mp-center-seek"><Progress times="sides" /></div>
          </div>

          <div className="mp-side">
            <Volume />
            <button type="button" className="mp-icon" onClick={() => setExpanded(true)} aria-label="Open Now Playing" title="Open Now Playing"><SvgIcon name="chevron-up" size={20} /></button>
            <button type="button" className="mp-icon" onClick={stopPlayback} aria-label="Close player" title="Close player"><SvgIcon name="close" size={16} /></button>
          </div>
        </div>
      </div>
    </>
  );
}
