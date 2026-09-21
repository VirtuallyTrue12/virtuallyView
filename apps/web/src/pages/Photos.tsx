import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';

interface Listing { path: string; folders: string[]; files: Array<{ name: string; size: number }> }
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Photos from the folder mounted at /media/photos. Folders, a grid, and a full-screen viewer with a slideshow. */
export default function Photos() {
  const [params, setParams] = useSearchParams();
  const dir = params.get('dir') ?? '';
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setListing(null); setError(''); setOpen(null);
    fetch(`/api/photos?dir=${encodeURIComponent(dir)}`).then(async r => {
      const body = (await r.json()) as Listing & { message?: string };
      if (!r.ok) throw new Error(body.message ?? 'Could not open the folder.');
      setListing(body);
    }).catch(err => setError((err as Error).message));
  }, [dir]);

  const count = listing?.files.length ?? 0;
  const step = useCallback((by: number) => setOpen(i => (i === null || !count ? i : (i + by + count) % count)), [count]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(null); setPlaying(false); }
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  useEffect(() => {
    if (!playing || open === null) return;
    const timer = window.setInterval(() => step(1), 4000);
    return () => window.clearInterval(timer);
  }, [playing, open, step]);

  const parts = dir ? dir.split('/') : [];
  return (
    <main className="page">
      <BackButton to="/" label="Home" />
      <div className="page-head"><h1>Photos</h1><span className="page-count">{count ? `${count} photos` : ''}</span></div>
      <nav className="crumbs" aria-label="Folder">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({})}>All photos</button>
        {parts.map((p, i) => <button key={i} type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ dir: parts.slice(0, i + 1).join('/') })}>{p}</button>)}
      </nav>
      {error && <div className="empty-state">{error}</div>}
      {!listing && !error && <div className="loading-state">Loading...</div>}
      {listing && listing.folders.length > 0 && (
        <div className="channel-grid">
          {listing.folders.map(f => <button key={f} type="button" className="channel-card" onClick={() => setParams({ dir: join(dir, f) })}><span className="channel-fallback">▤</span><span className="channel-name">{f}</span></button>)}
        </div>
      )}
      {listing && (
        <div className="photo-grid">
          {listing.files.map((f, i) => (
            <button key={f.name} type="button" className="photo-tile" onClick={() => setOpen(i)} aria-label={f.name}>
              <img src={`/api/photos/thumb?path=${encodeURIComponent(join(dir, f.name))}`} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {listing && !listing.folders.length && !listing.files.length && <div className="empty-state">This folder has no photos. Put photos in the folder mounted at /media/photos.</div>}
      {listing && open !== null && listing.files[open] && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer">
          <img src={`/api/photos/file?path=${encodeURIComponent(join(dir, listing.files[open]!.name))}`} alt={listing.files[open]!.name} />
          <div className="lightbox-bar">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => step(-1)}>Previous</button>
            <span>{listing.files[open]!.name} ({open + 1} of {count})</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => step(1)}>Next</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPlaying(p => !p)}>{playing ? 'Stop slideshow' : 'Slideshow'}</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setOpen(null); setPlaying(false); }}>Close</button>
          </div>
        </div>
      )}
    </main>
  );
}
