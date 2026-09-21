import { useEffect, useState } from 'react';
import { api, type PlaylistItem, type PlaylistTrack } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

interface Props {
  tracks: PlaylistTrack[];
  title: string;
  onClose: () => void;
  onSaved: (playlistName: string) => void;
}

/**
 * Small panel for saving tracks into a playlist. Lists existing playlists
 * with a Save button each, and offers create-and-save for a new one.
 */
export default function PlaylistPicker({ tracks, title, onClose, onSaved }: Props) {
  const [playlists, setPlaylists] = useState<PlaylistItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.playlists()
      .then(setPlaylists)
      .catch(err => setError(err instanceof Error ? err.message : 'Playlists could not be loaded.'));
  }, []);

  const saveAll = async (playlistId: string) => {
    for (const track of tracks) {
      await api.addPlaylistTrack(playlistId, track);
    }
  };

  const saveTo = async (playlistId: string) => {
    setSaving(playlistId);
    setError(null);
    try {
      await saveAll(playlistId);
      const playlist = playlists?.find(p => p.id === playlistId);
      onSaved(playlist?.name ?? 'playlist');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save to that playlist.');
      setSaving(null);
    }
  };

  const createAndSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createPlaylist(trimmed);
      await saveAll(created.id);
      onSaved(created.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that playlist.');
      setCreating(false);
    }
  };

  const firstTrackId = tracks[0]?.trackId;

  return (
    <div className="playlist-picker">
      <div className="playlist-picker-head">
        <span className="playlist-picker-title">Save to playlist</span>
        <span className="playlist-picker-sub">{title}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label="Close picker"><SvgIcon name="close" size={16} /></button>
      </div>
      {error && <div className="playlist-picker-error">{error}</div>}
      {playlists === null && !error && <div className="playlist-picker-loading">Loading playlists...</div>}
      {playlists && playlists.length === 0 && <div className="playlist-picker-empty">No playlists yet. Create one below.</div>}
      {playlists && playlists.length > 0 && (
        <div className="playlist-picker-list">
          {playlists.map(p => {
            const already = firstTrackId ? p.tracks.some(t => t.trackId === firstTrackId) : false;
            return (
              <div key={p.id} className="playlist-picker-row">
                <span className="playlist-picker-name">
                  {p.name}
                  <span className="playlist-picker-count">{p.tracks.length} {p.tracks.length === 1 ? 'track' : 'tracks'}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void saveTo(p.id)}
                  disabled={saving === p.id || already}
                >
                  {already ? 'Saved' : saving === p.id ? 'Saving...' : 'Save'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="playlist-picker-create">
        <input
          className="settings-input"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void createAndSave(); }}
          placeholder="New playlist name"
          maxLength={80}
          aria-label="New playlist name"
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void createAndSave()}
          disabled={creating || !name.trim()}
        >
          {creating ? 'Creating...' : 'Create and save'}
        </button>
      </div>
    </div>
  );
}