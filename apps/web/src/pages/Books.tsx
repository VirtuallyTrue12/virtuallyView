import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';

interface Listing { path: string; folders: string[]; files: Array<{ name: string; size: number }> }
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const size = (bytes: number) => (bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Books and comics from the folder mounted at /media/books. PDFs open in the browser; other formats download. */
export default function Books() {
  const [params, setParams] = useSearchParams();
  const dir = params.get('dir') ?? '';
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setListing(null); setError('');
    fetch(`/api/books?dir=${encodeURIComponent(dir)}`).then(async r => {
      const body = (await r.json()) as Listing & { message?: string };
      if (!r.ok) throw new Error(body.message ?? 'Could not open the folder.');
      setListing(body);
    }).catch(err => setError((err as Error).message));
  }, [dir]);

  const parts = dir ? dir.split('/') : [];
  return (
    <main className="page">
      <BackButton to="/" label="Home" />
      <div className="page-head"><h1>Books</h1></div>
      <nav className="crumbs" aria-label="Folder">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({})}>All books</button>
        {parts.map((p, i) => <button key={i} type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ dir: parts.slice(0, i + 1).join('/') })}>{p}</button>)}
      </nav>
      {error && <div className="empty-state">{error}</div>}
      {!listing && !error && <div className="loading-state">Loading...</div>}
      {listing && (
        <ul className="users-list">
          {listing.folders.map(f => <li key={f} className="users-row"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ dir: join(dir, f) })}>{f}</button></li>)}
          {listing.files.map(f => {
            const href = `/api/books/file?path=${encodeURIComponent(join(dir, f.name))}`;
            const pdf = /\.pdf$/i.test(f.name);
            return (
              <li key={f.name} className="users-row">
                <span className="users-name">{f.name}<small style={{ display: 'block', opacity: 0.7 }}>{size(f.size)}</small></span>
                <span className="users-actions"><a className="btn btn-primary btn-sm" href={href} target={pdf ? '_blank' : undefined} rel="noreferrer noopener" download={pdf ? undefined : f.name}>{pdf ? 'Read' : 'Download'}</a></span>
              </li>
            );
          })}
        </ul>
      )}
      {listing && !listing.folders.length && !listing.files.length && <div className="empty-state">No books here. Put PDF, EPUB or comic files in the folder mounted at /media/books.</div>}
    </main>
  );
}
