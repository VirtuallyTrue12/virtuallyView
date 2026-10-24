import { useEffect, useRef, useState } from 'react';
import { EQ_BANDS, EQ_PRESETS, useMusicPlayer, type QueueEntry, type RepeatMode } from '../media/MusicProvider';
import { audioEngine, say, djLine } from '../../lib/audio-engine';
import { LyricStyleToggle, LyricsOverlay, SceneTiles, VizCanvas } from './Visualizer';
import VizStage from './VizStage';
import { setViz, useLyricLine, useLyrics, useViz } from '../../lib/viz-store';
import { SvgIcon } from '../ui/SvgIcon';
import LyricsPanel from '../media/LyricsPanel';
import { SeekBar, formatClock } from './SeekBar';
import { useArtworkTint } from '../../lib/artwork-tint';

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
  const pick = (key: string) => { setEqEnabled(true); setEqPreset(key); };
  return (
    <div className={`eq2${eqEnabled ? '' : ' is-off'}`}>
      <div className="eq2-head">
        <button type="button" role="switch" aria-checked={eqEnabled} className={`toggle${eqEnabled ? ' is-on' : ''}`} onClick={() => setEqEnabled(!eqEnabled)}>
          <span className="toggle-knob" aria-hidden="true" />
          <span>{eqEnabled ? 'Equalizer on' : 'Equalizer off'}</span>
        </button>
        <div className="eq2-actions">
          {naming === null
            ? <button type="button" className="chip" onClick={() => setNaming('')}>+ Save as preset</button>
            : <form className="eq2-save" onSubmit={e => { e.preventDefault(); saveCustomPreset(naming); setNaming(null); }}>
                <input autoFocus value={naming} onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} placeholder="Preset name" maxLength={30} aria-label="Preset name" />
                <button type="submit" className="chip is-on" disabled={!naming.trim()}>Save</button>
              </form>}
          <button type="button" className="chip" onClick={() => { setEqPreset('flat'); setPreamp(0); setBalance(0); }}>Reset</button>
        </div>
      </div>
      <div className="chips" role="radiogroup" aria-label="Preset">
        {Object.entries(EQ_PRESETS).map(([key, p]) => (
          <button key={key} type="button" role="radio" aria-checked={eqEnabled && eqPreset === key} className={`chip${eqEnabled && eqPreset === key ? ' is-on' : ''}`} onClick={() => pick(key)}>{p.name}</button>
        ))}
        {customPresets.map(p => (
          <span key={p.name} className={`chip chip--mine${eqEnabled && eqPreset === `custom:${p.name}` ? ' is-on' : ''}`}>
            <button type="button" role="radio" aria-checked={eqEnabled && eqPreset === `custom:${p.name}`} onClick={() => pick(`custom:${p.name}`)}>★ {p.name}</button>
            <button type="button" className="chip-x" onClick={() => { deleteCustomPreset(p.name); if (eqPreset === `custom:${p.name}`) setEqPreset('flat'); }} aria-label={`Delete preset ${p.name}`}>×</button>
          </span>
        ))}
        {eqPreset === 'custom' && <span className="chip is-on chip--static">Custom</span>}
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
        <button type="button" role="switch" aria-checked={leveller} className={`toggle${leveller ? ' is-on' : ''}`} onClick={() => { setEqEnabled(true); setLeveller(!leveller); }}>
          <span className="toggle-knob" aria-hidden="true" />
          <span>Even out volume <small>quiet and loud songs play at a similar level</small></span>
        </button>
      </div>
      <p className="mix-help">Boosts lower the overall level a little so loud songs never crackle. Double-click a slider to zero it.</p>
    </div>
  );
}

type VoiceOption = { id: string; name: string; natural: boolean };

/** The natural voices on this server (when the voice service runs), then the browser's English voices. */
function useVoices(): { voices: VoiceOption[]; natural: boolean | null } {
  const [server, setServer] = useState<{ available: boolean; voices: { id: string; name: string }[] } | null>(null);
  const [browser, setBrowser] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    fetch('/api/tts/voices', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).then(setServer).catch(() => setServer({ available: false, voices: [] }));
    if (!('speechSynthesis' in window)) return;
    const load = () => setBrowser(window.speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)));
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  const voices: VoiceOption[] = [
    ...(server?.available ? server.voices.map(v => ({ id: v.id, name: v.name, natural: true })) : []),
    ...browser.map(v => ({ id: `browser:${v.name}`, name: v.name, natural: false }))
  ];
  return { voices, natural: server ? server.available : null };
}

function MixPanel() {
  const { crossfade, djMode, djVoice, entry, setCrossfade, setDjMode, setDjVoice } = useMusicPlayer();
  const { voices, natural } = useVoices();
  const [testing, setTesting] = useState<string | null>(null);
  const current = djVoice || voices[0]?.id || '';
  const test = async (id: string) => {
    setTesting(id);
    await say(djLine(null, { title: entry?.track.title ?? 'your music', artist: entry?.artistTitle }), id);
    setTesting(null);
  };
  return (
    <div className="mix">
      <div className="mix-card">
        <label className="eq2-row">
          <span>Crossfade</span>
          <input type="range" min={0} max={12} step={1} value={crossfade} onChange={e => setCrossfade(Number(e.target.value))} aria-label="Crossfade seconds" />
          <span className="eq2-val">{crossfade ? `${crossfade} s` : 'Off'}</span>
        </label>
        <p className="mix-help">The end of one song blends into the start of the next, with no gap.</p>
      </div>
      <div className="mix-card">
        <button type="button" role="switch" aria-checked={djMode} className={`toggle${djMode ? ' is-on' : ''}`} onClick={() => setDjMode(!djMode)}>
          <span className="toggle-knob" aria-hidden="true" />
          <span><strong>DJ mode</strong> <small>a host introduces each song while the last one fades out</small></span>
        </button>
        {djMode && (
          <div className="mix-voices" role="radiogroup" aria-label="DJ voice">
            {voices.length === 0 && <p className="mix-help">{natural === null ? 'Looking for voices…' : 'No voice is installed. Turn on the AI profile to get natural voices (see docs). The fades still work.'}</p>}
            {natural === false && voices.length > 0 && <p className="mix-help">Natural voices are off; using this browser's voices. Start the AI profile for a real radio-host voice.</p>}
            {voices.slice(0, 12).map(v => (
              <div key={v.id} className={`mix-voice${current === v.id ? ' is-on' : ''}`}>
                <button type="button" role="radio" aria-checked={current === v.id} className="mix-voice-pick" onClick={() => setDjVoice(v.id)}>
                  <span className="mix-voice-name">{v.name}</span>
                  {v.natural && <span className="mix-voice-tag">Natural</span>}
                </button>
                <button type="button" className="chip" onClick={() => void test(v.id)} disabled={testing !== null}>{testing === v.id ? 'Playing…' : 'Preview'}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VisualsPanel({ tint }: { tint: string }) {
  const viz = useViz();
  return (
    <div className="visuals">
      <SceneTiles tint={tint} />
      <LyricStyleToggle />
      <button type="button" role="switch" aria-checked={viz.screensaver} className={`toggle${viz.screensaver ? ' is-on' : ''}`} onClick={() => setViz({ screensaver: !viz.screensaver })}>
        <span className="toggle-knob" aria-hidden="true" />
        <span>Start full screen after a minute idle <small>like a screensaver; any key brings you back</small></span>
      </button>
      <button type="button" className="btn btn-primary" onClick={() => setViz({ stage: 'open' })}>Open full screen</button>
    </div>
  );
}

const loadPref = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const savePref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

type Tab = 'queue' | 'lyrics' | 'visuals' | 'eq' | 'mix';

function NowPlaying() {
  const { entry, expanded, setExpanded, currentTime, duration, error, stopPlayback, getTime, playing, djTalking } = useMusicPlayer();
  const [tab, setTab] = useState<Tab>(() => loadPref('vv-np-tab', 'queue') as Tab);
  useEffect(() => savePref('vv-np-tab', tab), [tab]);
  const viz = useViz();
  const tint = useArtworkTint(entry?.cover);
  const length = entry?.track.durationMs ? entry.track.durationMs / 1000 : (duration || undefined);
  const lyrics = useLyrics(entry?.artistTitle, entry?.track.title, entry?.albumTitle, length, expanded && viz.inPlayer && viz.lyricStyle !== 'off');
  const line = useLyricLine(lyrics, getTime, expanded && viz.inPlayer);
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
          <div className={`np-art${viz.inPlayer ? ' is-viz' : ''}`}>
            {viz.inPlayer && expanded
              ? <div className={`viz${playing ? '' : ' is-paused'}`}>
                  <VizCanvas scene={viz.scene} tint={tint} />
                  <LyricsOverlay line={line} style={viz.lyricStyle} state={lyrics === undefined ? 'loading' : lyrics?.synced?.length ? 'ok' : 'none'} />
                </div>
              : <Cover src={entry.cover} label={`${entry.albumTitle ?? entry.track.title} cover`} className="mp-cover--large" />}
            {djTalking && <span className="np-dj" role="status"><SvgIcon name="music-note" size={14} /> DJ</span>}
            <div className="np-viz-bar">
              <div className="seg" role="radiogroup" aria-label="Show">
                <button type="button" role="radio" aria-checked={!viz.inPlayer} className={`seg-btn${!viz.inPlayer ? ' is-on' : ''}`} onClick={() => setViz({ inPlayer: false })} tabIndex={expanded ? 0 : -1}>Cover</button>
                <button type="button" role="radio" aria-checked={viz.inPlayer} className={`seg-btn${viz.inPlayer ? ' is-on' : ''}`} onClick={() => setViz({ inPlayer: true })} tabIndex={expanded ? 0 : -1}>Visualizer</button>
              </div>
              <button type="button" className="chip" onClick={() => setViz({ stage: 'open' })} tabIndex={expanded ? 0 : -1}><SvgIcon name="maximize" size={14} /> Full screen</button>
              <button type="button" className="chip" onClick={() => setTab('visuals')} tabIndex={expanded ? 0 : -1}>Scenes</button>
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
              {([['queue', 'Up next'], ['lyrics', 'Lyrics'], ['visuals', 'Visuals'], ['eq', 'Equalizer'], ['mix', 'Mix & DJ']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={`np-tab${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)} tabIndex={expanded ? 0 : -1}>{label}</button>
              ))}
            </div>
            <div className="np-panel-body" role="tabpanel">
              {expanded && tab === 'queue' && <QueuePanel />}
              {expanded && tab === 'lyrics' && (
                <LyricsPanel artist={entry.artistTitle} title={entry.track.title} album={entry.albumTitle} durationSeconds={entry.track.durationMs ? entry.track.durationMs / 1000 : (duration || undefined)} currentTime={currentTime} />
              )}
              {expanded && tab === 'visuals' && <VisualsPanel tint={tint} />}
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
/** The current sung line under the title in the bottom bar, when the song has timed lyrics. */
function MiniLyric({ fallback }: { fallback: string }) {
  const { entry, getTime, playing } = useMusicPlayer();
  const viz = useViz();
  const on = viz.lyricStyle !== 'off';
  const lyrics = useLyrics(entry?.artistTitle, entry?.track.title, entry?.albumTitle, entry?.track.durationMs ? entry.track.durationMs / 1000 : undefined, on);
  const line = useLyricLine(lyrics, getTime, on && playing);
  return line.now
    ? <span key={line.now} className="mp-now-sub mp-now-lyric">♪ {line.now}</span>
    : <span className="mp-now-sub">{fallback}</span>;
}

export default function MusicPlayerUI() {
  const { entry, error, expanded, setExpanded, stopPlayback, playing } = useMusicPlayer();
  const tint = useArtworkTint(entry?.cover);
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
      <VizStage />
      <div ref={bar} className={`mp${expanded ? ' is-hidden' : ''}`} role="region" aria-label="Music player">
        {playing && !expanded && <VizCanvas scene="bars" tint={tint} variant="strip" className="mp-strip" />}
        <div className="mp-edge"><Progress times="none" /></div>
        <div className="mp-row">
          <button type="button" className="mp-now" onClick={() => setExpanded(true)} aria-label="Open Now Playing" title="Open Now Playing" tabIndex={expanded ? -1 : 0}>
            <Cover src={entry.cover} label="" className="mp-cover--mini" />
            <span className="mp-now-text">
              <span className="mp-now-title">{entry.track.title}</span>
              {error ? <span className="mp-now-sub">{error}</span> : <MiniLyric fallback={[entry.artistTitle, entry.albumTitle].filter(Boolean).join(' · ')} />}
            </span>
          </button>

          <div className="mp-center">
            <Transport />
            <div className="mp-center-seek"><Progress times="sides" /></div>
          </div>

          <div className="mp-side">
            <Volume />
            <button type="button" className="mp-icon" onClick={() => setViz({ stage: 'open' })} aria-label="Full-screen visualizer" title="Full-screen visualizer"><SvgIcon name="maximize" size={18} /></button>
            <button type="button" className="mp-icon" onClick={() => setExpanded(true)} aria-label="Open Now Playing" title="Open Now Playing"><SvgIcon name="chevron-up" size={20} /></button>
            <button type="button" className="mp-icon" onClick={stopPlayback} aria-label="Close player" title="Close player"><SvgIcon name="close" size={16} /></button>
          </div>
        </div>
      </div>
    </>
  );
}
