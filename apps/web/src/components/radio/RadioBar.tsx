import { useEffect, useRef } from 'react';
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
  return (
    <div ref={bar} className="rb" role="region" aria-label="Radio player">
      <StationLogo station={station} className="rb-logo" />
      <div className="rb-info">
        <strong className="rb-name">{station.name}</strong>
        <span className={`rb-sub${state === 'error' ? ' is-error' : ''}`} role="status">
          {state === 'error' ? error : busy ? 'Tuning in…' : state === 'paused' ? 'Paused' : nowTitle ?? [station.state, station.country].filter(Boolean).join(', ')}
        </span>
      </div>
      <span className={`rb-live${state === 'playing' ? ' is-on' : ''}`} aria-hidden="true">LIVE</span>
      <button type="button" className="rb-btn rb-btn--main" onClick={toggle} aria-label={state === 'playing' || busy ? 'Pause radio' : 'Play radio'}>
        {busy ? <span className="fx-spin" /> : <SvgIcon name={state === 'playing' ? 'pause' : 'play'} size={20} />}
      </button>
      <label className="rb-vol">
        <SvgIcon name={volume === 0 ? 'volume-mute' : 'volume-high'} size={16} />
        <input type="range" min={0} max={1} step={0.02} value={volume} onChange={e => setVolume(Number(e.target.value))} aria-label="Radio volume" />
      </label>
      <button type="button" className="rb-btn" onClick={stop} aria-label="Close radio"><SvgIcon name="close" size={16} /></button>
    </div>
  );
}
