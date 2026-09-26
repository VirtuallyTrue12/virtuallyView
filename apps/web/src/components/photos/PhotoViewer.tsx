import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoEntry } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

const src = (p: string, download = false) => `/api/photos/file?path=${encodeURIComponent(p)}${download ? '&download=1' : ''}`;
const size = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

export interface PhotoViewerProps {
  photos: PhotoEntry[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  favorites: Set<string>;
  onFavorite: (path: string) => void;
  onAddToAlbum: (path: string) => void;
  startPlaying?: boolean;
}

/** Full-screen viewer: swipe or arrow keys, zoom, slideshow, favorite, add to an album, download, details. */
export function PhotoViewer({ photos, index, onIndex, onClose, favorites, onFavorite, onAddToAlbum, startPlaying }: PhotoViewerProps) {
  const [playing, setPlaying] = useState(!!startPlaying);
  const [seconds, setSeconds] = useState(4);
  const [zoomed, setZoomed] = useState(false);
  const [info, setInfo] = useState(false);
  const [idle, setIdle] = useState(false);
  const [broken, setBroken] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const idleTimer = useRef<number | null>(null);
  const count = photos.length;
  const photo = photos[index];

  const step = useCallback((by: number) => { if (count) { setZoomed(false); setBroken(false); onIndex((index + by + count) % count); } }, [count, index, onIndex]);

  // Keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (info) setInfo(false); else onClose(); }
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      else if (e.key.toLowerCase() === 'f' && photo) onFavorite(photo.path);
      else if (e.key.toLowerCase() === 'i') setInfo(v => !v);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [step, onClose, onFavorite, photo, info]);

  // Slideshow.
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => step(1), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [playing, seconds, step]);

  // Controls fade away after a few quiet seconds during a slideshow.
  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    if (playing) idleTimer.current = window.setTimeout(() => setIdle(true), 2800);
  }, [playing]);
  useEffect(() => { wake(); return () => { if (idleTimer.current) window.clearTimeout(idleTimer.current); }; }, [wake, index]);

  // Warm the next picture so the slideshow never shows a blank.
  useEffect(() => { if (count > 1) { const next = photos[(index + 1) % count]; if (next) new Image().src = src(next.path); } }, [index, count, photos]);

  if (!photo) return null;
  const fav = favorites.has(photo.path);
  const folder = photo.path.includes('/') ? photo.path.slice(0, photo.path.lastIndexOf('/')) : 'Top folder';

  return (
    <div className={`pv${idle ? ' is-idle' : ''}${zoomed ? ' is-zoomed' : ''}`} role="dialog" aria-modal="true" aria-label="Photo viewer" onMouseMove={wake} onTouchStart={e => { touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }; wake(); }}
      onTouchEnd={e => {
        const t = touch.current; touch.current = null;
        if (!t || zoomed) return;
        const dx = e.changedTouches[0]!.clientX - t.x, dy = e.changedTouches[0]!.clientY - t.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
        else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose();
      }}>
      <header className="pv-bar">
        <button type="button" className="pv-btn" onClick={onClose} aria-label="Close"><SvgIcon name="close" size={22} /></button>
        <div className="pv-title"><strong>{photo.name}</strong><span>{index + 1} of {count}</span></div>
        <div className="pv-actions">
          <button type="button" className={`pv-btn${fav ? ' is-on' : ''}`} onClick={() => onFavorite(photo.path)} aria-pressed={fav} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} title="Favorite (F)"><SvgIcon name={fav ? 'heart' : 'heart-outline'} size={21} /></button>
          <button type="button" className="pv-btn" onClick={() => onAddToAlbum(photo.path)} aria-label="Add to an album" title="Add to an album"><SvgIcon name="plus" size={21} /></button>
          <a className="pv-btn" href={src(photo.path, true)} download aria-label="Download the original" title="Download"><SvgIcon name="download" size={21} /></a>
          <button type="button" className={`pv-btn${info ? ' is-on' : ''}`} onClick={() => setInfo(v => !v)} aria-pressed={info} aria-label="Details" title="Details (I)"><SvgIcon name="info" size={21} /></button>
          <button type="button" className={`pv-btn${playing ? ' is-on' : ''}`} onClick={() => setPlaying(p => !p)} aria-pressed={playing} aria-label={playing ? 'Stop slideshow' : 'Start slideshow'} title="Slideshow (Space)"><SvgIcon name={playing ? 'pause' : 'play'} size={20} /></button>
        </div>
      </header>

      <div className="pv-stage" onClick={() => count && setZoomed(z => !z)}>
        {broken ? <p className="pv-broken">This photo could not be opened.</p> : <img key={photo.path} src={src(photo.path)} alt={photo.name} draggable={false} onError={() => setBroken(true)} />}
      </div>
      {count > 1 && <>
        <button type="button" className="pv-nav pv-nav--prev" onClick={() => step(-1)} aria-label="Previous photo"><SvgIcon name="chevron-left" size={28} /></button>
        <button type="button" className="pv-nav pv-nav--next" onClick={() => step(1)} aria-label="Next photo"><SvgIcon name="chevron-right" size={28} /></button>
      </>}
      {playing && <div className="pv-progress" key={`${index}-${seconds}`} style={{ animationDuration: `${seconds}s` }} aria-hidden="true" />}

      {info && (
        <aside className="pv-info" aria-label="Photo details">
          <h3>Details</h3>
          <dl>
            <div><dt>File</dt><dd>{photo.name}</dd></div>
            <div><dt>Folder</dt><dd>{folder}</dd></div>
            <div><dt>Size</dt><dd>{size(photo.size)}</dd></div>
            <div><dt>Date</dt><dd>{new Date(photo.modified).toLocaleString()}</dd></div>
          </dl>
          <label className="pv-speed">Slideshow speed
            <select value={seconds} onChange={e => setSeconds(Number(e.target.value))} className="settings-input">
              <option value={2}>Fast (2 s)</option><option value={4}>Normal (4 s)</option><option value={8}>Slow (8 s)</option><option value={15}>Very slow (15 s)</option>
            </select>
          </label>
          <p className="pv-keys">Keys: ← → move · Space slideshow · F favorite · I details · Esc close. Click the photo to zoom.</p>
        </aside>
      )}
    </div>
  );
}
