import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MediaCard } from '../components/media/MediaCard';
import { api, type MediaItem, type PlaylistItem } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';
import { ScanButton } from '../components/media/ScanButton';
import { AddArtist } from '../components/media/AddArtist';
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
    } catch (err) {
      setPlaylistError(err instanceof Error ? err.message : 'Could not create that playlist.');
    } finally {
      setCreating(false);
    }
  };

  const totalTracks = (playlists ?? []).reduce((sum, p) => sum + p.tracks.length, 0);

  return (
    <main className="page">

      <BackButton to="/" label="Home" />
      <div className="page-head">
        <h1>Music</h1>
        <div className="page-head-actions">
          <span className="page-count">{items.length} artists</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void shuffleLibrary()} disabled={mixing || items.length === 0}>{mixing ? 'Mixing...' : 'Shuffle library'}</button>
          <ScanButton type="artist" />
        </div>
      </div>

      <AddArtist onAdded={() => { api.artists().then(res => setItems(res ?? [])).catch(() => {}); }} />

      <section className="playlists-section" aria-label="Playlists">
        <div className="playlists-head">
          <h2 className="section-title">Playlists</h2>
          <span className="page-count">{totalTracks} {totalTracks === 1 ? 'track' : 'tracks'} across {playlists?.length ?? 0} {playlists?.length === 1 ? 'playlist' : 'playlists'}</span>
        </div>
        <div className="playlist-create-row">
          <input
            className="settings-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void createPlaylist(); }}
            placeholder="New playlist name"
            maxLength={80}
            aria-label="New playlist name"
          />
          <button type="button" className="btn btn-primary" onClick={() => void createPlaylist()} disabled={creating || !newName.trim()}>
            {creating ? 'Creating...' : 'Create playlist'}
          </button>
        </div>
        {playlistError && <p className="playlist-error">{playlistError}</p>}
        {playlists && playlists.length === 0 && (
          <div className="empty-state playlist-empty">Your playlists appear here. Open any album and save tracks to a playlist.</div>
        )}
        {playlists && playlists.length > 0 && (
          <div className="playlist-grid">
            {playlists.map(playlist => (
              <Link key={playlist.id} to={`/playlists/${playlist.id}`} className="playlist-card">
                <span className="playlist-card-name">{playlist.name}</span>
                <span className="playlist-card-meta">
                  {playlist.tracks.length} {playlist.tracks.length === 1 ? 'track' : 'tracks'}
                  {playlist.tracks[0]?.cover && (
                    <img className="playlist-card-cover" src={playlist.tracks[0].cover} alt="" loading="lazy" />
                  )}
                </span>
              </Link>
            ))}
          </div>
        )}
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