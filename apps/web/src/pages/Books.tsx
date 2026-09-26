import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type PhotoEntry } from '../lib/api';
import { EmptyState, PageHeader, Seg } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';

type View = 'library' | 'folders' | 'favorites';
type Format = 'all' | 'pdf' | 'epub' | 'comic' | 'other';
type Sort = 'new' | 'name' | 'size';
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const size = (bytes: number) => (bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const formatOf = (name: string): Exclude<Format, 'all'> => { const e = extOf(name); return e === 'pdf' ? 'pdf' : e === 'epub' ? 'epub' : e === 'cbz' || e === 'cbr' ? 'comic' : 'other'; };
const titleOf = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
const hue = (text: string) => [...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 11);
const PAGE = 90;

function Book({ book, fav, onFavorite }: { book: PhotoEntry; fav: boolean; onFavorite: () => void }) {
  const href = `/api/books/file?path=${encodeURIComponent(book.path)}`;
  const ext = extOf(book.name);
  const inBrowser = ext === 'pdf' || ext === 'txt';
  const folder = book.path.includes('/') ? book.path.slice(0, book.path.lastIndexOf('/')) : '';
  const h = hue(book.name);
  return (
    <article className="bk">
      <a className="bk-cover" href={href} target={inBrowser ? '_blank' : undefined} rel="noreferrer noopener" download={inBrowser ? undefined : book.name} style={{ background: `linear-gradient(155deg, hsl(${h} 45% 38%), hsl(${(h + 40) % 360} 50% 20%))` }} aria-label={`${inBrowser ? 'Read' : 'Download'} ${titleOf(book.name)}`}>
        <span className="bk-ext">{ext.toUpperCase()}</span>
        <span className="bk-title">{titleOf(book.name)}</span>
      </a>
      <div className="bk-meta">
        <div><strong title={book.name}>{titleOf(book.name)}</strong><span>{folder ? `${folder} · ` : ''}{size(book.size)}</span></div>
        <button type="button" className={`lv-heart${fav ? ' is-on' : ''}`} onClick={onFavorite} aria-pressed={fav} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}><SvgIcon name={fav ? 'heart' : 'heart-outline'} size={17} /></button>
      </div>
      <a className={`btn ${inBrowser ? 'btn-primary' : 'btn-secondary'} btn-sm bk-open`} href={href} target={inBrowser ? '_blank' : undefined} rel="noreferrer noopener" download={inBrowser ? undefined : book.name}><SvgIcon name={inBrowser ? 'book' : 'download'} size={15} /> {inBrowser ? 'Read' : 'Download'}</a>
    </article>
  );
}

/** Books and comics from the folder mounted at /media/books. PDFs and text open in the browser; other formats download. */
export default function Books() {
  const [params, setParams] = useSearchParams();
  const view = (['library', 'folders', 'favorites'].includes(params.get('v') ?? '') ? params.get('v') : 'library') as View;
  const dir = params.get('dir') ?? '';
  const [all, setAll] = useState<PhotoEntry[] | null>(null);
  const [error, setError] = useState('');
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState<{ folders: string[]; files: PhotoEntry[] } | null>(null);
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState<Format>('all');
  const [sort, setSort] = useState<Sort>('new');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    api.booksAll().then(r => setAll(r.items)).catch(err => { setAll([]); setError((err as Error).message); });
    api.bookFavorites().then(r => setFavs(new Set(r.paths))).catch(() => {});
  }, []);
  useEffect(() => {
    if (view !== 'folders') return;
    setFolder(null);
    api.booksFolder(dir).then(l => setFolder({ folders: l.folders, files: l.files.map(f => ({ path: join(dir, f.name), name: f.name, size: f.size, modified: f.modified ?? 0 })) })).catch(err => setError((err as Error).message));
  }, [view, dir]);
  useEffect(() => { setShown(PAGE); }, [view, dir, query, format, sort]);

  const toggleFavorite = (path: string) => {
    const on = !favs.has(path);
    setFavs(prev => { const n = new Set(prev); if (on) n.add(path); else n.delete(path); return n; });
    api.setBookFavorite(path, on).catch(() => setFavs(prev => { const n = new Set(prev); if (on) n.delete(path); else n.add(path); return n; }));
  };

  const source = useMemo(() => (view === 'folders' ? folder?.files ?? [] : view === 'favorites' ? (all ?? []).filter(b => favs.has(b.path)) : all ?? []), [view, folder, all, favs]);
  const counts = useMemo(() => { const c: Record<Format, number> = { all: source.length, pdf: 0, epub: 0, comic: 0, other: 0 }; for (const b of source) c[formatOf(b.name)]++; return c; }, [source]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = source.filter(b => (format === 'all' || formatOf(b.name) === format) && (!q || b.path.toLowerCase().includes(q)));
    return [...out].sort(sort === 'name' ? (a, b) => titleOf(a.name).localeCompare(titleOf(b.name), undefined, { numeric: true, sensitivity: 'base' }) : sort === 'size' ? (a, b) => b.size - a.size : (a, b) => b.modified - a.modified);
  }, [source, query, format, sort]);

  const parts = dir ? dir.split('/') : [];
  const empty = all !== null && all.length === 0;
  const chips: Array<[Format, string]> = [['all', 'All'], ['pdf', 'PDF'], ['epub', 'EPUB'], ['comic', 'Comics'], ['other', 'Other']];

  return (
    <main className="page">
      <PageHeader title="Books" sub={all === null ? 'Loading…' : empty ? undefined : `${all.length.toLocaleString()} books and comics${favs.size ? ` · ${favs.size} favorite${favs.size === 1 ? '' : 's'}` : ''}`} />
      {error && !empty && <div className="notice notice--err" role="alert">{error}</div>}
      {empty && <EmptyState icon="book" title="No books yet" text={<>Put PDF, EPUB or comic files in the folder mounted at <code>/media/books</code> (folders are fine) and they show up here. Files are only read, never changed.</>} action={<a className="btn btn-secondary" href="https://github.com/VirtuallyTrue12/virtuallyView/blob/main/docs/features.md" target="_blank" rel="noreferrer">How to add a book folder</a>} />}

      {all !== null && !empty && (
        <>
          <div className="ph-toolbar">
            <Seg<View> label="Book views" value={view} onChange={v => setParams(v === 'library' ? {} : { v })} options={[{ value: 'library', label: 'Library' }, { value: 'folders', label: 'Folders' }, { value: 'favorites', label: 'Favorites', count: favs.size }]} />
            <div className="bk-tools">
              <input className="settings-input ph-search" type="search" placeholder="Search by title or folder" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search books" />
              <select className="settings-input" value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort by"><option value="new">Newest</option><option value="name">A to Z</option><option value="size">Largest</option></select>
            </div>
          </div>
          <div className="lv-chips" role="tablist" aria-label="Format">
            {chips.filter(([f]) => f === 'all' || counts[f] > 0).map(([f, label]) => <button key={f} type="button" role="tab" aria-selected={format === f} className={`season-tab${format === f ? ' is-active' : ''}`} onClick={() => setFormat(f)}>{label} ({counts[f]})</button>)}
          </div>

          {view === 'folders' && (
            <>
              <nav className="ph-crumbs" aria-label="Folder">
                <button type="button" onClick={() => setParams({ v: 'folders' })} className={!dir ? 'is-here' : ''}>All books</button>
                {parts.map((p, i) => <span key={i}><SvgIcon name="chevron-right" size={14} /><button type="button" className={i === parts.length - 1 ? 'is-here' : ''} onClick={() => setParams({ v: 'folders', dir: parts.slice(0, i + 1).join('/') })}>{p}</button></span>)}
              </nav>
              {folder && folder.folders.length > 0 && <div className="ph-folders">{folder.folders.map(f => <button key={f} type="button" className="ph-folder" onClick={() => setParams({ v: 'folders', dir: join(dir, f) })}><SvgIcon name="folder" size={22} /><span>{f}</span></button>)}</div>}
            </>
          )}

          {list.length === 0 && !(view === 'folders' && !folder) ? (
            view === 'favorites' && !query && format === 'all' ? <EmptyState icon="heart-outline" title="No favorites yet" text="Tap the heart on a book to keep it here." />
              : view === 'folders' && folder && folder.folders.length > 0 && !query ? null
              : <EmptyState icon="search" title="Nothing matches" text="Try another word or format." />
          ) : (
            <>
              <div className="bk-grid">{list.slice(0, shown).map(b => <Book key={b.path} book={b} fav={favs.has(b.path)} onFavorite={() => toggleFavorite(b.path)} />)}</div>
              {shown < list.length && <button type="button" className="btn btn-secondary lv-more" onClick={() => setShown(n => n + PAGE)}>Show more ({list.length - shown} left)</button>}
            </>
          )}
        </>
      )}
    </main>
  );
}
