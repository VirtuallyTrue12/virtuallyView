import { useEffect, useRef, useState } from 'react';
import { useRadio } from './RadioProvider';
import { StationLogo } from './StationLogo';
import { SvgIcon } from '../ui/SvgIcon';
import { kindLine, mmss, nowLines } from './info';
import { api } from '../../lib/api';

const tints = new Map<string, string>();

/** Hue picked from the station's name, the same one its logo badge uses, so the two always agree. */
const hue = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function hslToRgb(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255)).join(', ');
}

/** The glow colour for the expanded view: sampled from the station's own picture when it has one, else its badge colour. */
function useStationTint(hasLogo: boolean, src: string | undefined, fallbackHue: number): string {
  const [tint, setTint] = useState(() => (src ? tints.get(src) : undefined) ?? hslToRgb(fallbackHue, 45, 32));
  useEffect(() => {
    if (!hasLogo || !src) { setTint(hslToRgb(fallbackHue, 45, 32)); return; }
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
          if (luma < 28 || luma > 232) continue;
          const w = 0.15 + (max === 0 ? 0 : (max - min) / max);
          r += R * w; g += G * w; b += B * w; weight += w;
        }
        if (weight > 0) {
          const value = `${Math.round(r / weight)}, ${Math.round(g / weight)}, ${Math.round(b / weight)}`;
          tints.set(src, value);
          if (!cancelled) setTint(value);
        }
      } catch { /* a picture the canvas cannot read: keep the badge colour */ }
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [hasLogo, src, fallbackHue]);
  return tint;
}

const SLEEP = [['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['90', '90 minutes'], ['hour', 'End of this hour']] as const;
const RECORD = [15, 30, 60, 120];
const minutesToHour = () => { const d = new Date(); return 60 - d.getMinutes() - d.getSeconds() / 60; };

/** The radio's own full-screen Now Playing: big art (the album cover when the station tells the song), what is on,
 * pause and rewind, the sleep timer and recording. */
export function RadioNowPlaying() {
  const { station, state, error, now, expanded, setExpanded, volume, setVolume, toggle, stop, timeshift, skip, seekTo, goLive, sleepAt, setSleep, canRecord, record } = useRadio();
  const sleepLeft = sleepAt ? Math.max(1, Math.round((sleepAt - Date.now()) / 60000)) : 0;
  const tint = useStationTint(!!station?.logo, station ? `/api/radio/logo/${station.id}` : undefined, station ? hue(station.name) : 0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (expanded) {
      returnTo.current = document.activeElement;
      sheetRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    } else if (returnTo.current instanceof HTMLElement) {
      returnTo.current.focus({ preventScroll: true });
      returnTo.current = null;
    }
  }, [expanded]);

  // The heart lives here too: on a TV the remote skips the small hearts on the tiles.
  const [favorite, setFavorite] = useState(false);
  useEffect(() => {
    if (!expanded || !station) return;
    let alive = true;
    api.radioMe().then(m => { if (alive) setFavorite(m.favorites.some(f => f.id === station.id)); }).catch(() => undefined);
    return () => { alive = false; };
  }, [expanded, station]);
  const toggleFavorite = () => {
    if (!station) return;
    const next = !favorite;
    setFavorite(next);
    api.radioFavorite(station.id, next).then(() => window.dispatchEvent(new Event('vv-radio-favorites'))).catch(() => setFavorite(!next));
  };

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, setExpanded]);

  if (!station) return null;
  const busy = state === 'loading';
  const playing = state === 'playing';
  const behind = timeshift?.behind ?? 0;
  const lines = nowLines(station, now, behind);
  const cover = behind === 0 ? now?.art : undefined;
  const tab = expanded ? 0 : -1;
  // A slider would trap the TV remote's arrows, so there the 30-second buttons do the job.
  const onTv = document.documentElement.classList.contains('tv');

  return (
    <div ref={sheetRef} tabIndex={-1} className={`np${expanded ? ' is-open' : ''}`} role="dialog" aria-modal={expanded || undefined} aria-label="Now playing" aria-hidden={!expanded} style={{ ['--np-tint' as string]: tint }}>
      <div className="np-glow" aria-hidden="true" />
      <div className="np-inner">
        <header className="np-top">
          <button type="button" className="mp-icon np-collapse" onClick={() => setExpanded(false)} aria-label="Close" title="Close" tabIndex={tab}><SvgIcon name="chevron-down" size={22} /></button>
          <span className="np-top-title">Radio</span>
          <button type="button" className="mp-icon np-collapse" onClick={stop} aria-label="Stop and close player" title="Stop and close" tabIndex={tab}><SvgIcon name="close" size={18} /></button>
        </header>

        <div className="np-body rnp-body">
          <div className="np-art">{cover ? <img className="rnp-cover" src={cover} alt="" /> : <StationLogo station={station} className="rnp-art" />}</div>

          <div className="np-main">
            <div className="np-meta">
              <span className={`rb-pill${playing && !behind ? ' is-on' : ''}`}>{playing && !behind && <span className="rb-eq" aria-hidden="true"><i /><i /><i /><i /></span>}{behind ? `-${mmss(behind)} behind live` : 'LIVE'}</span>
              <h2 className="np-title" title={lines.title}>{lines.title}</h2>
              <p className="np-sub">{lines.title === station.name ? kindLine(station) || lines.sub : lines.sub}</p>
              {error && <p className="np-error" role="alert">{error}</p>}
            </div>

            {timeshift && (
              <div className="rnp-scrub">
                <input className="mp-range" type="range" min={timeshift.start} max={Math.max(timeshift.end, timeshift.pos)} step={1} value={timeshift.pos} tabIndex={onTv ? -1 : tab}
                  style={{ ['--v' as string]: (timeshift.pos - timeshift.start) / Math.max(1, timeshift.end - timeshift.start) }}
                  onChange={e => seekTo(Number(e.target.value))} aria-label="Position in the last half hour" aria-valuetext={behind ? `${mmss(behind)} behind live` : 'Live'} />
                <span className="rnp-scrub-hint">{mmss(Math.max(0, timeshift.end - timeshift.start))} you can rewind</span>
              </div>
            )}
            <div className="mp-transport mp-transport--large">
              {timeshift && <button type="button" className="mp-icon rnp-skip" onClick={() => skip(-30)} aria-label="Back 30 seconds" title="Back 30 seconds" tabIndex={tab}><SvgIcon name="prev" size={22} /><small>30</small></button>}
              <button type="button" data-autofocus className={`mp-play${busy ? ' is-buffering' : ''}`} onClick={toggle} aria-label={playing || busy ? 'Pause radio' : 'Play radio'} title={playing || busy ? 'Pause' : 'Play'} tabIndex={tab}>
                {busy ? <span className="fx-spin" /> : <SvgIcon name={playing ? 'pause' : 'play'} size={28} />}
              </button>
              {timeshift && <button type="button" className="mp-icon rnp-skip" onClick={() => skip(30)} disabled={!behind} aria-label="Forward 30 seconds" title="Forward 30 seconds" tabIndex={tab}><SvgIcon name="next" size={22} /><small>30</small></button>}
            </div>
            {timeshift && behind > 0 && <button type="button" className="btn btn-primary rnp-golive" onClick={goLive} tabIndex={tab}>Go live</button>}

            <label className="mp-volume">
              <button type="button" className="mp-icon" onClick={() => setVolume(volume === 0 ? 1 : 0)} aria-label={volume === 0 ? 'Unmute radio' : 'Mute radio'} tabIndex={tab}><SvgIcon name={volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high'} size={18} /></button>
              <input className="mp-range" type="range" min={0} max={1} step={0.02} value={volume} tabIndex={onTv ? -1 : tab} style={{ ['--v' as string]: volume }} onChange={e => setVolume(Number(e.target.value))} aria-label="Radio volume" />
            </label>
            <div className="np-viz-bar rnp-extras">
              <button type="button" className={`np-chip rnp-fav${favorite ? ' is-on' : ''}`} onClick={toggleFavorite} aria-pressed={favorite} tabIndex={tab}>
                <SvgIcon name={favorite ? 'heart' : 'heart-outline'} size={16} />{favorite ? 'In favorites' : 'Add to favorites'}
              </button>
              <select className="np-chip" value="" onChange={e => setSleep(e.target.value === 'hour' ? minutesToHour() : e.target.value ? Number(e.target.value) : null)} aria-label="Sleep timer" tabIndex={tab}>
                <option value="">{sleepAt ? `Sleep in ${sleepLeft} min` : 'Sleep timer'}</option>
                {sleepAt && <option value="0">Cancel sleep timer</option>}
                {SLEEP.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              {canRecord && (
                <select className="np-chip" value="" onChange={e => { if (e.target.value) void record(Number(e.target.value)); }} aria-label="Record this station" tabIndex={tab}>
                  <option value="">Record</option>
                  {RECORD.map(m => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>)}
                </select>
              )}
            </div>
            {station.homepage && <a className="mp-link rnp-home" href={station.homepage} target="_blank" rel="noreferrer" tabIndex={tab}>Visit the station's site</a>}
          </div>
        </div>
      </div>
    </div>
  );
}
