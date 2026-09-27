import { useEffect, useRef, type CSSProperties } from 'react';
import { useRadio } from './RadioProvider';
import { SvgIcon } from '../ui/SvgIcon';
import { StationLogo } from './StationLogo';

/** The bar at the bottom while a station plays: what it is, what is on, pause and stop, volume. */
export function RadioBar() {
  const { station, state, error, nowTitle, volume, toggle, stop, setVolume } = useRadio();
  const bar = useRef<HTMLDivElement>(null);
  // Floating buttons (the assistant, the requests pill) sit above whatever is docked at the bottom.
  useEffect(() => {
    const el = bar.current;
    const root = document.documentElement;
    if (!el) return;
    const update = () => root.style.setProperty('--dock-bottom', `${Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top))}px`);
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); root.style.removeProperty('--dock-bottom'); };
  }, [station]);
  if (!station) return null;
  const busy = state === 'loading';
  const playing = state === 'playing';
  const place = [station.state, station.country].filter(Boolean).join(', ');
  const spec = [station.codec, station.bitrate ? `${station.bitrate} kbps` : ''].filter(Boolean).join(' ');
  const title = state === 'error' ? station.name : nowTitle ?? station.name;
  const sub = state === 'error' ? error : busy ? 'Tuning in…' : state === 'paused' ? `${station.name} · Paused` : nowTitle ? station.name : place;
  return (
    <div ref={bar} className="mp rb" role="region" aria-label="Radio player">
      <div className="mp-row">
        <div className="mp-now">
          <StationLogo station={station} className={`rb-cover${playing ? ' is-live' : ''}`} large />
          <span className="mp-now-text">
            <span className="mp-now-title">{title}</span>
            <span className={`mp-now-sub${state === 'error' ? ' is-error' : ''}`} role="status">{sub}</span>
          </span>
        </div>

        <div className="mp-center">
          <div className="mp-transport">
            <button type="button" className={`mp-play${busy ? ' is-buffering' : ''}`} onClick={toggle} aria-label={playing || busy ? 'Pause radio' : 'Play radio'} title={playing || busy ? 'Pause' : 'Play'}>
              {busy ? <span className="fx-spin" /> : <SvgIcon name={playing ? 'pause' : 'play'} size={20} />}
            </button>
            <button type="button" className="mp-icon" onClick={stop} aria-label="Close radio" title="Close radio"><SvgIcon name="close" size={16} /></button>
          </div>
          <div className="mp-center-seek rb-live-row">
            <span className={`rb-pill${playing ? ' is-on' : ''}`}>{playing && <span className="rb-eq" aria-hidden="true"><i /><i /><i /><i /></span>}LIVE</span>
            <span className="rb-spec">{[place, spec].filter(Boolean).join(' · ')}</span>
          </div>
        </div>

        <div className="mp-side">
          <label className="mp-volume">
            <button type="button" className="mp-icon" onClick={() => setVolume(volume === 0 ? 1 : 0)} aria-label={volume === 0 ? 'Unmute radio' : 'Mute radio'}><SvgIcon name={volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high'} size={18} /></button>
            <input className="mp-range" type="range" min={0} max={1} step={0.02} value={volume} style={{ '--v': volume } as CSSProperties} onChange={e => setVolume(Number(e.target.value))} aria-label="Radio volume" />
          </label>
        </div>
      </div>
    </div>
  );
}
