import { useEffect, useRef, useState } from 'react';
import { useRadio } from './RadioProvider';
import { StationLogo } from './StationLogo';
import { SvgIcon } from '../ui/SvgIcon';

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

/** The radio's own full-screen Now Playing, the same idea as the music player's: big art, a live pill instead of
 * a seek bar (there is nothing to seek), and what the station itself says is playing. */
export function RadioNowPlaying() {
  const { station, state, error, nowTitle, expanded, setExpanded, volume, setVolume, toggle, stop } = useRadio();
  const tint = useStationTint(!!station?.logo, station ? `/api/radio/logo/${station.id}` : undefined, station ? hue(station.name) : 0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

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

  if (!station) return null;
  const busy = state === 'loading';
  const playing = state === 'playing';
  const place = [station.state, station.country].filter(Boolean).join(', ');
  const spec = [station.codec, station.bitrate ? `${station.bitrate} kbps` : ''].filter(Boolean).join(' ');

  return (
    <div ref={sheetRef} tabIndex={-1} className={`np${expanded ? ' is-open' : ''}`} role="dialog" aria-label="Now playing" aria-hidden={!expanded} style={{ ['--np-tint' as string]: tint }}>
      <div className="np-glow" aria-hidden="true" />
      <div className="np-inner">
        <header className="np-top">
          <button type="button" className="mp-icon np-collapse" onClick={() => setExpanded(false)} aria-label="Close Now Playing" tabIndex={expanded ? 0 : -1}><SvgIcon name="chevron-down" size={22} /></button>
          <span className="np-top-title">Now playing on the radio</span>
          <button type="button" className="mp-icon np-collapse" onClick={stop} aria-label="Stop and close player" title="Stop and close" tabIndex={expanded ? 0 : -1}><SvgIcon name="close" size={18} /></button>
        </header>

        <div className="np-body rnp-body">
          <div className="np-art"><StationLogo station={station} className="rnp-art" /></div>

          <div className="np-main">
            <div className="np-meta">
              <span className={`rb-pill${playing ? ' is-on' : ''}`}>{playing && <span className="rb-eq" aria-hidden="true"><i /><i /><i /><i /></span>}LIVE</span>
              <h2 className="np-title" title={nowTitle ?? station.name}>{nowTitle ?? station.name}</h2>
              <p className="np-sub">{nowTitle ? station.name : place}{nowTitle && place ? ` · ${place}` : ''}</p>
              {spec && <span className="np-quality">{spec}</span>}
              {station.tags.length > 0 && <p className="rnp-tags">{station.tags.join(' · ')}</p>}
              {error && <p className="np-error" role="alert">{error}</p>}
            </div>
            <div className="mp-transport mp-transport--large">
              <button type="button" className={`mp-play${busy ? ' is-buffering' : ''}`} onClick={toggle} aria-label={playing || busy ? 'Pause radio' : 'Play radio'} title={playing || busy ? 'Pause' : 'Play'}>
                {busy ? <span className="fx-spin" /> : <SvgIcon name={playing ? 'pause' : 'play'} size={28} />}
              </button>
            </div>
            <label className="mp-volume">
              <button type="button" className="mp-icon" onClick={() => setVolume(volume === 0 ? 1 : 0)} aria-label={volume === 0 ? 'Unmute radio' : 'Mute radio'}><SvgIcon name={volume === 0 ? 'volume-mute' : volume < 0.5 ? 'volume-low' : 'volume-high'} size={18} /></button>
              <input className="mp-range" type="range" min={0} max={1} step={0.02} value={volume} style={{ ['--v' as string]: volume }} onChange={e => setVolume(Number(e.target.value))} aria-label="Radio volume" />
            </label>
            {station.homepage && <a className="mp-link rnp-home" href={station.homepage} target="_blank" rel="noreferrer">Visit the station's site</a>}
          </div>
        </div>
      </div>
    </div>
  );
}
