import { useState } from 'react';
import { api, type LibraryTrack, type PlaylistTrack, type PromptedPlaylist as Result } from '../../lib/api';
import { useMusicPlayer } from '../media/MusicProvider';
import { queueEntryOf } from './music-queue';
import './MusicDiscovery.css';

const EXAMPLE = 'late-night drive, no ballads';

const snapshot = (t: LibraryTrack): PlaylistTrack => ({
  trackId: t.trackId,
  title: t.title,
  artistTitle: t.artistTitle,
  albumTitle: t.albumTitle,
  albumId: t.albumId,
  cover: t.cover,
  quality: t.quality,
  durationMs: t.durationMs
});

/** Describe a playlist in words; the library supplies the tracks. */
export default function PromptedPlaylist() {
  const { playQueue } = useMusicPlayer();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);

  const make = async () => {
    const text = prompt.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setSavedAs(null);
    try {
      setResult(await api.promptPlaylist(text));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'The playlist could not be made.');
    } finally {
      setBusy(false);
    }
  };

  // Saves the list as an ordinary playlist, so it can be opened and edited like any other.
  const save = async () => {
    if (!result?.tracks.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.createPlaylist((result.name || prompt.trim()).slice(0, 80));
      for (const track of result.tracks) await api.addPlaylistTrack(created.id, snapshot(track));
      setSavedAs(created.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That playlist could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="prompted-playlist" aria-label="Prompted playlist">
      <form className="pp-form" onSubmit={e => { e.preventDefault(); void make(); }}>
        <label className="pp-label" htmlFor="pp-prompt">Describe a playlist</label>
        <div className="pp-row">
          <input
            id="pp-prompt"
            className="settings-input"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={`for example "${EXAMPLE}"`}
            maxLength={200}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || prompt.trim().length < 3}>
            {busy ? 'Making...' : 'Make playlist'}
          </button>
        </div>
      </form>

      {error && <p className="notice notice--err" role="alert">{error}</p>}

      {result && (
        <div className="pp-result">
          {result.message && <p className="pp-note" role="status">{result.message}</p>}
          {result.tracks.length === 0 ? (
            !result.message && <p className="pp-note">No tracks in your library match that yet.</p>
          ) : (
            <>
              <h3 className="pp-name">{result.name}</h3>
              <div className="pp-actions">
                <button type="button" className="btn btn-primary" onClick={() => playQueue(result.tracks.map(queueEntryOf), 0)}>Play now</button>
                <button type="button" className="btn btn-secondary" onClick={() => void save()} disabled={saving || !!savedAs}>
                  {saving ? 'Saving...' : savedAs ? 'Saved' : 'Save as playlist'}
                </button>
              </div>
              {savedAs && <p className="pp-note">Saved as "{savedAs}".</p>}
              <ol className="pp-tracks">
                {result.tracks.map(track => (
                  <li key={track.trackId} className="pp-track">
                    <span className="pp-track-title">{track.title}</span>
                    <span className="pp-track-artist">{track.artistTitle}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
