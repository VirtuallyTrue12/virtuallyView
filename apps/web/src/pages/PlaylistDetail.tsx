import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type PlaylistItem } from '../lib/api';
import { useMusicPlayer, type QueueEntry } from '../components/media/MusicProvider';
import { BackButton } from '../components/layout/BackButton';
import { SvgIcon } from '../components/ui/SvgIcon';

function formatDuration(ms?: number): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playQueue, index, playing } = useMusicPlayer();
  const [playlist, setPlaylist] = useState<PlaylistItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    setError(null);
    api.playlist(id)
      .then(setPlaylist)
      .catch(err => setError(err.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const queue: QueueEntry[] = (playlist?.tracks ?? []).map(track => ({
    track: { id: Number(track.trackId), title: track.title, quality: track.quality, durationMs: track.durationMs },
    albumTitle: track.albumTitle,
    artistTitle: track.artistTitle,
    albumId: track.albumId,
    cover: track.cover
  }));

  const playAll = () => {
    if (queue.length) playQueue(queue, 0);
  };

  const removeTrack = async (trackId: string) => {
    if (!id) return;
    try {
      const updated = await api.removePlaylistTrack(id, trackId);
      setPlaylist(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that track.');
    }
  };

  const saveRename = async () => {
    if (!id || !draftName.trim()) return;
    try {
      const updated = await api.renamePlaylist(id, draftName.trim());
      setPlaylist(updated);
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the playlist.');
    }
  };

  const deletePlaylist = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await api.deletePlaylist(id);
      navigate('/music');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the playlist.');
      setDeleting(false);
    }
  };

  if (error) {
    return (
      <main className="page">
        <BackButton to="/music" label="Music" />
        <div className="empty-state">
          <h1 className="detail-title">Playlist unavailable</h1>
          <p>{error}</p>
          <Link to="/music" className="btn btn-secondary">Back to Music</Link>
        </div>
      </main>
    );
  }

  if (!playlist) {
    return (
      <main className="page">
        <BackButton to="/music" label="Music" />
        <div className="loading-state">Loading playlist...</div>
      </main>
    );
  }

  const totalMinutes = playlist.tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0) / 60000;

  return (
    <main className="page">
      <BackButton to="/music" label="Music" />
      <div className="page-head">
        <div className="page-head-title">
          <h1>{playlist.name}</h1>
          <span className="page-count">
            {playlist.tracks.length} {playlist.tracks.length === 1 ? 'track' : 'tracks'}
            {totalMinutes > 0 && ` · ${Math.round(totalMinutes)} min`}
          </span>
        </div>
        <div className="page-head-actions">
          {renaming ? (
            <span className="rename-inline">
              <input
                className="settings-input rename-input"
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') setRenaming(false); }}
                placeholder="Playlist name"
                autoFocus
                aria-label="Playlist name"
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveRename()}>Save</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRenaming(false)}>Cancel</button>
            </span>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setDraftName(playlist.name); setRenaming(true); }}>
              Rename
            </button>
          )}
          {confirmDelete ? (
            <span className="delete-confirm-inline">
              <span className="delete-confirm-text">Delete this playlist?</span>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void deletePlaylist()} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </span>
          ) : (
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete playlist</button>
          )}
        </div>
      </div>

      {playlist.tracks.length === 0 && (
        <div className="empty-state">
          <p>This playlist is empty. Add tracks from any album in your Music library.</p>
          <Link to="/music" className="btn btn-primary">Browse Music</Link>
        </div>
      )}

      {playlist.tracks.length > 0 && (
        <div className="album-tracks">
          <div className="album-tracks-list playlist-tracks">
            <div className="playlist-actions-row">
              <button type="button" className="btn btn-primary" onClick={playAll}><SvgIcon name="play" size={14} /> Play all</button>
            </div>
            {playlist.tracks.map((track, i) => {
              const isActive = playing && index === i && queue[index]?.track.id === Number(track.trackId);
              return (
                <div key={track.trackId} className={`album-track-row playlist-track-row${isActive ? ' is-active' : ''}`}>
                  <button type="button" className="playlist-track-main" onClick={() => playQueue(queue, i)}>
                    <span className="playlist-track-cover">
                      {track.cover ? <img src={track.cover} alt="" /> : <span className="playlist-track-cover-empty" />}
                    </span>
                    <span className="album-track-num">{isActive ? <SvgIcon name="play" size={12} /> : String(i + 1)}</span>
                    <span className="album-track-title">
                      {track.title}
                      {track.albumTitle && <span className="album-track-sub">{track.artistTitle} · {track.albumTitle}</span>}
                    </span>
                    {track.quality && <span className="album-track-quality">{track.quality}</span>}
                    <span className="album-track-dur">{formatDuration(track.durationMs)}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm playlist-remove"
                    onClick={() => void removeTrack(track.trackId)}
                    aria-label={`Remove ${track.title}`}
                  >
                    <SvgIcon name="close" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}