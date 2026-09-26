import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type PhotoAlbum, type PhotoEntry } from '../lib/api';
import { EmptyState, PageHeader, Seg } from '../components/ui/Page';
import { Dialog } from '../components/ui/Dialog';
import { MenuItem, MoreMenu } from '../components/ui/MoreMenu';
import { SvgIcon } from '../components/ui/SvgIcon';
import { PhotoViewer } from '../components/photos/PhotoViewer';

type View = 'timeline' | 'folders' | 'albums' | 'favorites';
const thumb = (p: string) => `/api/photos/thumb?path=${encodeURIComponent(p)}`;
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const monthOf = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const PAGE = 240;

function Tile({ photo, fav, selecting, selected, onOpen, onSelect, onFavorite }: { photo: PhotoEntry; fav: boolean; selecting: boolean; selected: boolean; onOpen: () => void; onSelect: () => void; onFavorite: () => void }) {
  return (
    <div className={`ph-tile${selected ? ' is-selected' : ''}`}>
      <button type="button" className="ph-open" onClick={selecting ? onSelect : onOpen} aria-label={selecting ? `Select ${photo.name}` : `Open ${photo.name}`} aria-pressed={selecting ? selected : undefined}>
        <img src={thumb(photo.path)} alt="" loading="lazy" />
      </button>
      {selecting
        ? <span className="ph-check" aria-hidden="true">{selected && <SvgIcon name="check" size={16} />}</span>
        : <button type="button" className={`ph-heart${fav ? ' is-on' : ''}`} onClick={onFavorite} aria-pressed={fav} aria-label={fav ? `Remove ${photo.name} from favorites` : `Favorite ${photo.name}`}><SvgIcon name={fav ? 'heart' : 'heart-outline'} size={16} /></button>}
    </div>
  );
}

/** Photos from the folder mounted at /media/photos: a timeline, folders, your own albums and favorites, with a full-screen viewer. */
export default function Photos() {
  const [params, setParams] = useSearchParams();
  const view = (['timeline', 'folders', 'albums', 'favorites'].includes(params.get('v') ?? '') ? params.get('v') : 'timeline') as View;
  const dir = params.get('dir') ?? '';
  const albumId = params.get('album') ?? '';

  const [all, setAll] = useState<PhotoEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [albums, setAlbums] = useState<PhotoAlbum[]>([]);
  const [folder, setFolder] = useState<{ folders: string[]; files: PhotoEntry[] } | null>(null);
  const [album, setAlbum] = useState<{ id: string; name: string; photos: PhotoEntry[] } | null>(null);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ list: PhotoEntry[]; index: number; play: boolean } | null>(null);
  const [picker, setPicker] = useState<string[] | null>(null);
  const [newName, setNewName] = useState('');
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadAlbums = useCallback(() => { api.photoAlbums().then(r => setAlbums(r.albums)).catch(() => {}); }, []);
  useEffect(() => {
    api.photosAll().then(r => { setAll(r.items); setTruncated(r.truncated); }).catch(err => { setAll([]); setError((err as Error).message); });
    api.photoFavorites().then(r => setFavs(new Set(r.paths))).catch(() => {});
    loadAlbums();
  }, [loadAlbums]);

  useEffect(() => {
    if (view !== 'folders') return;
    setFolder(null);
    api.photosFolder(dir).then(l => setFolder({ folders: l.folders, files: l.files.map(f => ({ path: join(dir, f.name), name: f.name, size: f.size, modified: f.modified ?? 0 })) })).catch(err => setError((err as Error).message));
  }, [view, dir]);

  useEffect(() => {
    if (view !== 'albums' || !albumId) { setAlbum(null); return; }
    api.photoAlbum(albumId).then(setAlbum).catch(() => { setAlbum(null); setParams({ v: 'albums' }); });
  }, [view, albumId, setParams]);

  useEffect(() => { setShown(PAGE); setSelected(new Set()); setSelecting(false); }, [view, dir, albumId, query]);

  const toggleFavorite = useCallback((path: string) => {
    const on = !favs.has(path);
    setFavs(prev => { const next = new Set(prev); if (on) next.add(path); else next.delete(path); return next; });
    api.setPhotoFavorite(path, on).catch(() => setFavs(prev => { const next = new Set(prev); if (on) next.delete(path); else next.add(path); return next; }));
  }, [favs]);

  const q = query.trim().toLowerCase();
  const matches = useCallback((p: PhotoEntry) => !q || p.path.toLowerCase().includes(q), [q]);
  const timeline = useMemo(() => (all ?? []).filter(matches), [all, matches]);
  const favorites = useMemo(() => (all ?? []).filter(p => favs.has(p.path) && matches(p)), [all, favs, matches]);
  const list: PhotoEntry[] = view === 'timeline' ? timeline : view === 'favorites' ? favorites : view === 'folders' ? (folder?.files ?? []).filter(matches) : (album?.photos ?? []).filter(matches);

  // Show more as the end of the grid scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !('IntersectionObserver' in window)) { setShown(list.length); return; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setShown(n => n + PAGE); }, { rootMargin: '900px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length, view]);

  const visible = list.slice(0, shown);
  const groups = useMemo(() => {
    if (view !== 'timeline') return [{ label: '', items: visible }];
    const out: Array<{ label: string; items: PhotoEntry[] }> = [];
    for (const p of visible) { const label = monthOf(p.modified); const last = out[out.length - 1]; if (last && last.label === label) last.items.push(p); else out.push({ label, items: [p] }); }
    return out;
  }, [visible, view]);

  const open = (photo: PhotoEntry, play = false) => { const index = list.findIndex(p => p.path === photo.path); if (index >= 0) setViewer({ list, index, play }); };
  const toggleSelect = (path: string) => setSelected(prev => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const setView = (v: View) => setParams(v === 'timeline' ? {} : { v });

  const addToAlbum = async (albumIdTarget: string | null) => {
    if (!picker) return;
    try {
      if (albumIdTarget) await api.changePhotoAlbum(albumIdTarget, { add: picker });
      else await api.createPhotoAlbum(newName.trim(), picker);
      const name = albumIdTarget ? albums.find(a => a.id === albumIdTarget)?.name : newName.trim();
      setNote({ tone: 'ok', text: `Added ${picker.length} photo${picker.length === 1 ? '' : 's'} to "${name}".` });
      setPicker(null); setNewName(''); setSelecting(false); setSelected(new Set()); loadAlbums();
      if (album && albumIdTarget === album.id) api.photoAlbum(album.id).then(setAlbum).catch(() => {});
    } catch (err) { setNote({ tone: 'err', text: (err as Error).message }); }
  };

  const removeFromAlbum = async (paths: string[]) => {
    if (!album) return;
    await api.changePhotoAlbum(album.id, { remove: paths }).catch(() => {});
    setAlbum({ ...album, photos: album.photos.filter(p => !paths.includes(p.path)) });
    setSelected(new Set()); loadAlbums();
  };

  const empty = all !== null && all.length === 0;
  const parts = dir ? dir.split('/') : [];
  const count = all?.length ?? 0;

  return (
    <main className="page ph-page">
      <PageHeader
        title="Photos"
        sub={all === null ? 'Loading…' : empty ? undefined : `${count.toLocaleString()} photos${favs.size ? ` · ${favs.size} favorite${favs.size === 1 ? '' : 's'}` : ''}${albums.length ? ` · ${albums.length} album${albums.length === 1 ? '' : 's'}` : ''}`}
        actions={!empty && all !== null ? <>
          <button type="button" className="btn btn-primary" disabled={list.length === 0} onClick={() => list[0] && setViewer({ list, index: 0, play: true })}><SvgIcon name="play" size={17} /> Slideshow</button>
          <button type="button" className="btn btn-secondary" disabled={list.length === 0} onClick={() => (selecting ? (setSelecting(false), setSelected(new Set())) : setSelecting(true))} aria-pressed={selecting}><SvgIcon name={selecting ? 'close' : 'check'} size={17} /> {selecting ? 'Done' : 'Select'}</button>
        </> : undefined}
      />

      {error && !empty && <div className="notice notice--err" role="alert">{error}</div>}
      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}

      {empty && (
        <EmptyState icon="camera" title="No photos yet" text={<>Put your photos in the folder mounted at <code>/media/photos</code> (folders are fine) and they show up here with a timeline, albums and favorites. Photos are only read, never changed.</>} action={<a className="btn btn-secondary" href="https://github.com/VirtuallyTrue12/virtuallyView/blob/main/docs/features.md" target="_blank" rel="noreferrer">How to add a photo folder</a>} />
      )}

      {all !== null && !empty && (
        <>
          <div className="ph-toolbar">
            <Seg<View> label="Photo views" value={view} onChange={setView} options={[
              { value: 'timeline', label: 'Timeline' }, { value: 'folders', label: 'Folders' }, { value: 'albums', label: 'Albums', count: albums.length }, { value: 'favorites', label: 'Favorites', count: favs.size }
            ]} />
            {view !== 'albums' || albumId ? <input className="settings-input ph-search" type="search" placeholder="Search by name or folder" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search photos" /> : null}
          </div>

          {view === 'folders' && (
            <nav className="ph-crumbs" aria-label="Folder">
              <button type="button" onClick={() => setParams({ v: 'folders' })} className={!dir ? 'is-here' : ''}>All photos</button>
              {parts.map((p, i) => <span key={i}><SvgIcon name="chevron-right" size={14} /><button type="button" className={i === parts.length - 1 ? 'is-here' : ''} onClick={() => setParams({ v: 'folders', dir: parts.slice(0, i + 1).join('/') })}>{p}</button></span>)}
            </nav>
          )}
          {view === 'folders' && folder && folder.folders.length > 0 && (
            <div className="ph-folders">
              {folder.folders.map(f => <button key={f} type="button" className="ph-folder" onClick={() => setParams({ v: 'folders', dir: join(dir, f) })}><SvgIcon name="folder" size={22} /><span>{f}</span></button>)}
            </div>
          )}

          {view === 'albums' && !albumId && (
            <div className="ph-albums">
              <button type="button" className="ph-album ph-album--new" onClick={() => setPicker([])}><span className="ph-album-cover"><SvgIcon name="plus" size={28} /></span><strong>New album</strong><span>Group photos your way</span></button>
              {albums.map(a => (
                <button key={a.id} type="button" className="ph-album" onClick={() => setParams({ v: 'albums', album: a.id })}>
                  <span className="ph-album-cover">{a.cover ? <img src={thumb(a.cover)} alt="" loading="lazy" /> : <SvgIcon name="image" size={28} />}</span>
                  <strong>{a.name}</strong><span>{a.count} photo{a.count === 1 ? '' : 's'}</span>
                </button>
              ))}
            </div>
          )}
          {view === 'albums' && albumId && album && (
            <div className="ph-album-head">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setParams({ v: 'albums' })}><SvgIcon name="arrow-left" size={15} /> Albums</button>
              <h2>{album.name}</h2>
              <MoreMenu label="Album options">
                <MenuItem icon="edit" label="Rename" onSelect={() => { const name = window.prompt('Album name', album.name); if (name?.trim()) api.changePhotoAlbum(album.id, { name }).then(() => { setAlbum({ ...album, name: name.trim() }); loadAlbums(); }).catch(() => {}); }} />
                <MenuItem icon="trash" label="Delete album" hint="The photos stay where they are" danger onSelect={() => { if (window.confirm(`Delete the album "${album.name}"? The photos themselves are not touched.`)) api.deletePhotoAlbum(album.id).then(() => { setParams({ v: 'albums' }); loadAlbums(); }).catch(() => {}); }} />
              </MoreMenu>
            </div>
          )}

          {(view !== 'albums' || albumId) && (
            list.length === 0 && (view !== 'folders' || folder) ? (
              view === 'favorites' ? <EmptyState icon="heart-outline" title="No favorites yet" text="Tap the heart on any photo. Favorites are just yours." />
                : view === 'albums' ? <EmptyState icon="image" title="This album is empty" text="Open the timeline, choose Select, and add photos to this album." />
                : q ? <EmptyState icon="search" title="Nothing matches" text={`No photos have "${query}" in their name or folder.`} />
                : view === 'folders' && folder && folder.folders.length > 0 ? null : <EmptyState icon="image" title="No photos here" />
            ) : (
              <div className="ph-groups">
                {groups.map(g => (
                  <section key={g.label || 'all'} aria-label={g.label || undefined}>
                    {g.label && <h2 className="ph-month">{g.label}</h2>}
                    <div className="ph-grid">
                      {g.items.map(p => <Tile key={p.path} photo={p} fav={favs.has(p.path)} selecting={selecting} selected={selected.has(p.path)} onOpen={() => open(p)} onSelect={() => toggleSelect(p.path)} onFavorite={() => toggleFavorite(p.path)} />)}
                    </div>
                  </section>
                ))}
                {shown < list.length && <div ref={sentinel} className="ph-more">Loading more…</div>}
                {view === 'timeline' && truncated && shown >= list.length && <p className="ui-help">Showing the newest 6,000 photos. Use Folders to reach the rest.</p>}
              </div>
            )
          )}
        </>
      )}

      {selecting && (
        <div className="rq-bulk ph-bulk" role="region" aria-label="Selected photos">
          <strong>{selected.size} selected</strong>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set(visible.map(p => p.path)))}>Select all shown</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!selected.size} onClick={() => setPicker([...selected])}><SvgIcon name="plus" size={15} /> Add to album</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!selected.size} onClick={() => { for (const p of selected) if (!favs.has(p)) toggleFavorite(p); setNote({ tone: 'ok', text: 'Added to your favorites.' }); }}><SvgIcon name="heart-outline" size={15} /> Favorite</button>
          {view === 'albums' && albumId && <button type="button" className="btn btn-danger btn-sm" disabled={!selected.size} onClick={() => void removeFromAlbum([...selected])}>Remove from album</button>}
        </div>
      )}

      <Dialog open={picker !== null} onClose={() => { setPicker(null); setNewName(''); }} title={picker && picker.length ? `Add ${picker.length} photo${picker.length === 1 ? '' : 's'} to an album` : 'New album'}>
        {picker && (
          <div className="ph-pick">
            {albums.length > 0 && picker.length > 0 && (
              <ul className="ph-pick-list">
                {albums.map(a => <li key={a.id}><button type="button" onClick={() => void addToAlbum(a.id)}><span className="ph-pick-cover">{a.cover ? <img src={thumb(a.cover)} alt="" /> : <SvgIcon name="image" size={18} />}</span><span><strong>{a.name}</strong><em>{a.count} photo{a.count === 1 ? '' : 's'}</em></span></button></li>)}
              </ul>
            )}
            <form onSubmit={e => { e.preventDefault(); if (newName.trim()) void addToAlbum(null); }} className="ph-pick-new">
              <input className="settings-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="New album name" maxLength={80} aria-label="New album name" autoFocus />
              <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>{picker.length ? 'Create and add' : 'Create'}</button>
            </form>
          </div>
        )}
      </Dialog>

      {viewer && <PhotoViewer photos={viewer.list} index={viewer.index} startPlaying={viewer.play} onIndex={i => setViewer(v => v && { ...v, index: i })} onClose={() => setViewer(null)} favorites={favs} onFavorite={toggleFavorite} onAddToAlbum={path => setPicker([path])} />}
    </main>
  );
}
