import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MediaCard } from '../components/media/MediaCard';
import { api, type MediaItem, type PlaylistItem } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';
import { ScanButton } from '../components/media/ScanButton';
import { PendingMusicVideos } from '../components/media/PendingMusicVideos';
import { AddArtist } from '../components/media/AddArtist';
import { Dialog } from '../components/ui/Dialog';
import { SvgIcon } from '../components/ui/SvgIcon';
import { LibraryControls, useLibraryView } from '../components/media/LibraryControls';
import { useMusicPlayer } from '../components/media/MusicProvider';
import { libraryMix } from '../lib/instant-mix';

export default function Music() {
  const navigate = useNavigate();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistItem[] | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [creatingOpen, setCreatingOpen] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { api.authStatus().then(st => setIsAdmin(st.user?.role === 'admin')).catch(() => {}); }, []);
  const { playQueue } = useMusicPlayer();
  const [mixing, setMixing] = useState(false);
  const lib = useLibraryView(items, 'music');
  const shuffleLibrary = async () => {
    setMixing(true);
    try {
      const queue = await libraryMix(items);
      if (queue.length) playQueue(queue, 0);
    } finally {
      setMixing(false);
    }
  };
  const surprise = () => {
    const pool = lib.shown.filter(i => i.status === 'available');
    const pick = (pool.length ? pool : lib.shown)[Math.floor(Math.random() * (pool.length || lib.shown.length))];
    if (pick) navigate(`/music/${pick.id}`);
  };

  useEffect(() => {
    api.artists()
      .then(res => setItems(res ?? []))
      .catch(() => setError('Music service not configured'))
      .finally(() => setLoading(false));
    api.playlists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, []);

  const createPlaylist = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setPlaylistError(null);
    try {
      const created = await api.createPlaylist(name);
      setPlaylists(prev => [created, ...(prev ?? [])]);
      setNewName('');
      setCreatingOpen(false);
    } catch (err) {
      setPlaylistError(err instanceof Error ? err.message : 'Could not create that playlist.');
    } finally {
      setCreating(false);
    }
  };

  const totalTracks = (playlists ?? []).reduce((sum, p) => sum + p.tracks.length, 0);

  return (
    <main className="page music-page">
      <BackButton to="/" label="Home" />

      <header className="lib-head">
        <div className="lib-head-text">
          <h1>Music</h1>
          <p className="lib-sub">{items.length} {items.length === 1 ? 'artist' : 'artists'}{playlists && playlists.length > 0 ? ` · ${playlists.length} ${playlists.length === 1 ? 'playlist' : 'playlists'}` : ''}</p>
        </div>
        <div className="lib-actions">
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><SvgIcon name="plus" size={17} /> Add artist</button>
          <button type="button" className="btn btn-secondary" onClick={() => void shuffleLibrary()} disabled={mixing || items.length === 0}><SvgIcon name="shuffle" size={17} /> {mixing ? 'Mixing…' : 'Shuffle'}</button>
          <ScanButton type="artist" />
        </div>
      </header>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add an artist">
        <AddArtist bare onAdded={() => { setAdding(false); api.artists().then(res => setItems(res ?? [])).catch(() => {}); }} />
      </Dialog>

      {isAdmin && <PendingMusicVideos onFiled={() => { api.artists().then(res => setItems(res ?? [])).catch(() => {}); }} />}

      <section className="pl" aria-label="Playlists">
        <div className="rail-head">
          <h2 className="rail-title">Playlists</h2>
          {playlists && playlists.length > 0 && <span className="page-count">{totalTracks} {totalTracks === 1 ? 'track' : 'tracks'}</span>}
        </div>
        <div className="pl-rail">
          {creatingOpen ? (
            <form className="pl-new pl-new--open" onSubmit={e => { e.preventDefault(); void createPlaylist(); }}>
              <input className="settings-input" autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setCreatingOpen(false); }}
                placeholder="Playlist name" maxLength={80} aria-label="New playlist name" />
              <div className="pl-new-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={creating || !newName.trim()}>{creating ? 'Creating…' : 'Create'}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setCreatingOpen(false); setNewName(''); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <button type="button" className="pl-new" onClick={() => setCreatingOpen(true)}>
              <span className="pl-new-plus"><SvgIcon name="plus" size={22} /></span>
              <span className="pl-new-label">New playlist</span>
            </button>
          )}
          {(playlists ?? []).map(playlist => (
            <Link key={playlist.id} to={`/playlists/${playlist.id}`} className="pl-card">
              <span className="pl-cover">
                {playlist.tracks[0]?.cover ? <img src={playlist.tracks[0].cover} alt="" loading="lazy" /> : <SvgIcon name="music-note" size={26} />}
              </span>
              <span className="pl-name">{playlist.name}</span>
              <span className="pl-meta">{playlist.tracks.length} {playlist.tracks.length === 1 ? 'track' : 'tracks'}</span>
            </Link>
          ))}
        </div>
        {playlistError && <p className="playlist-error" role="alert">{playlistError}</p>}
        {playlists && playlists.length === 0 && !creatingOpen && <p className="pl-hint">Playlists you make appear here. Open an album and save tracks to one.</p>}
      </section>

      {loading && <div className="loading-state">Loading music...</div>}
      {error && <div className="loading-state">Music unavailable: {error}</div>}
      {!loading && items.length === 0 && !error && <div className="empty-state">No music here yet. Connect your Music service and your library will appear.</div>}
      {!loading && items.length > 0 && (
        <section aria-label="Artists">
          <LibraryControls view={lib.view} setView={lib.setView} genres={lib.genres} letters={lib.letters} total={items.length} shown={lib.shown.length} onSurprise={surprise} showRuntime={false} />
          {lib.shown.length === 0 && <div className="empty-state">Nothing matches these filters.</div>}
          <div className="media-grid">
            {lib.shown.map(item => (
              <MediaCard key={item.id} item={item} showStatus progress={item.watchProgress} to={`/music/${item.id}`} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}