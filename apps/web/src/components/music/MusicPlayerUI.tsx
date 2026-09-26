import { useEffect, useRef, useState } from 'react';
import { EQ_BANDS, EQ_PRESETS, useMusicPlayer, type QueueEntry, type RepeatMode } from '../media/MusicProvider';
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

function EqualizerPanel() {
  const { eqEnabled, eqPreset, eqBands, setEqEnabled, setEqPreset, setEqBand } = useMusicPlayer();
  return (
    <div className="equalizer mp-eq">
      <div className="equalizer-head">
        <label className="equalizer-toggle">
          <input type="checkbox" checked={eqEnabled} onChange={e => setEqEnabled(e.target.checked)} />
          <span>Enabled</span>
        </label>
        <div className="equalizer-presets">
          {Object.entries(EQ_PRESETS).map(([key, preset]) => (
            <button key={key} type="button" className={`btn btn-secondary btn-sm${eqPreset === key ? ' is-active' : ''}`} onClick={() => { setEqEnabled(true); setEqPreset(key); }}>{preset.name}</button>
          ))}
        </div>
      </div>
      <div className="equalizer-bands">
        {EQ_BANDS.map((band, i) => (
          <label key={band.label} className="equalizer-band">
            <span className="equalizer-band-gain">{(eqBands[i] ?? 0) > 0 ? `+${eqBands[i]}` : eqBands[i]} dB</span>
            <input type="range" min={-12} max={12} step={1} value={eqBands[i] ?? 0} onChange={e => { setEqEnabled(true); setEqBand(i, Number(e.target.value)); }} aria-label={`${band.label} gain`} />
            <span className="equalizer-band-label">{band.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

type Tab = 'queue' | 'lyrics' | 'eq';

function NowPlaying() {
  const { entry, expanded, setExpanded, currentTime, duration, error, stopPlayback } = useMusicPlayer();
  const [tab, setTab] = useState<Tab>('queue');
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
          <div className="np-art"><Cover src={entry.cover} label={`${entry.albumTitle ?? entry.track.title} cover`} className="mp-cover--large" /></div>

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
              {([['queue', 'Up next'], ['lyrics', 'Lyrics'], ['eq', 'Equalizer']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={`np-tab${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)} tabIndex={expanded ? 0 : -1}>{label}</button>
              ))}
            </div>
            <div className="np-panel-body" role="tabpanel">
              {expanded && tab === 'queue' && <QueuePanel />}
              {expanded && tab === 'lyrics' && (
                <LyricsPanel artist={entry.artistTitle} title={entry.track.title} album={entry.albumTitle} durationSeconds={entry.track.durationMs ? entry.track.durationMs / 1000 : (duration || undefined)} currentTime={currentTime} />
              )}
              {expanded && tab === 'eq' && <EqualizerPanel />}
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
    const update = () => root.style.setProperty('--dock-bottom', `${expanded ? 0 : el.offsetHeight}px`);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => { observer?.disconnect(); root.style.removeProperty('--dock-bottom'); };
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
