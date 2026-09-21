import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';
import { api, type AlbumItem, type PlaylistTrack, type TrackItem } from '../lib/api';
import { useMusicPlayer } from '../components/media/MusicProvider';
import PlaylistPicker from '../components/media/PlaylistPicker';
import { SvgIcon } from '../components/ui/SvgIcon';

type PickerState = null | { kind: 'album' } | { kind: 'track'; track: TrackItem };

export default function AlbumDetails() {
  const { id } = useParams<{ id: string }>();
  const { entry, playQueue, playing, index } = useMusicPlayer();
  const [album, setAlbum] = useState<AlbumItem & { artistTitle?: string } | null>(null);
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [searchNote, setSearchNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError(null);
    setAlbum(null);
    setTracks([]);
    api.album(id)
      .then(({ album, tracks }) => {
        setAlbum(album);
        setTracks(tracks);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Album could not be loaded.'));
  }, [id]);

  const playableTracks = tracks.filter(t => t.hasFile);
  const queue = playableTracks.map(track => ({
    track: { id: track.id, title: track.title, quality: track.quality, durationMs: track.durationMs },
    albumTitle: album?.title,
    artistTitle: album?.artistTitle,
    albumId: album ? `album-${album.id}` : undefined,
    cover: album?.artwork?.cover
  }));

  const snapshotFor = (track: TrackItem): PlaylistTrack => ({
    trackId: String(track.id),
    title: track.title,
    artistTitle: album?.artistTitle,
    albumTitle: album?.title,
    albumId: album ? `album-${album.id}` : undefined,
    cover: album?.artwork?.cover,
    quality: track.quality,
    durationMs: track.durationMs
  });

  const isActiveTrack = (track: TrackItem) =>
    playing && queue.length > 0 && entry?.track.id === track.id && queue[index]?.track.id === track.id;

  if (error) {
    return (
      <main className="page">
        <BackButton to="/music" label="Music" />
        <div className="empty-state">
          <h1 className="detail-title">Album unavailable</h1>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!album) {
    return (
      <main className="page">
        <BackButton to="/music" label="Music" />
        <div className="loading-state">Loading album...</div>
      </main>
    );
  }

  const playable = playableTracks.length;
  const missing = tracks.length - playable;
  const searchAlbum = async () => {
    setSearching(true);
    setSearchNote(null);
    try {
      const result = await api.searchAlbum(id ?? '');
      setSearchNote({ tone: 'ok', text: result.message });
    } catch (err) {
      setSearchNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setSearching(false);
    }
  };
  const artistHref = album.artistId
    ? `/music/${String(album.artistId).startsWith('lidarr-') ? album.artistId : `lidarr-${album.artistId}`}`
    : '/music';

  return (
    <main className="page">
      <BackButton to={artistHref} exact label={album.artistTitle ?? 'Music'} />

      <div className="album-hero">
        {album.artwork?.cover && (
          <img className="album-hero-cover" src={album.artwork.cover} alt={`${album.title} cover`} loading="lazy" />
        )}
        <div className="album-hero-info">
          <span className="album-hero-type">{album.albumType ?? 'Album'}</span>
          <h1 className="detail-title">{album.title}</h1>
          {album.artistTitle && <p className="album-hero-artist">{album.artistTitle}</p>}
          <div className="detail-meta">
            {album.releaseDate ? <span>{album.releaseDate.slice(0, 4)}</span> : null}
            <span>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>
            {album.duration ? <span>{Math.round(album.duration / 60000)} min</span> : null}
            {album.ratings?.value ? <span className="rating">{album.ratings.value.toFixed(1)} <SvgIcon name="star" size={14} /></span> : null}
          </div>
          {playable > 0 && (
            <div className="album-actions">
              <button type="button" className="btn btn-primary" onClick={() => playQueue(queue, 0)}>
                Play album
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { setSavedNote(null); setPicker({ kind: 'album' }); }}>
                Save to playlist
              </button>
            </div>
          )}
          {missing > 0 && (
            <div className="album-actions">
              <button type="button" className="btn btn-secondary" onClick={() => void searchAlbum()} disabled={searching}>
                {searching ? 'Searching...' : playable === 0 ? 'Search for this album' : `Search for ${missing} missing ${missing === 1 ? 'track' : 'tracks'}`}
              </button>
            </div>
          )}
          {searchNote && <div className={`notice notice--${searchNote.tone}`} role="status">{searchNote.text}</div>}
          {savedNote && <p className="album-saved-note">Added to {savedNote}.</p>}
        </div>
      </div>

      {picker && (
        <PlaylistPicker
          tracks={picker.kind === 'album' ? playableTracks.map(snapshotFor) : [snapshotFor(picker.track)]}
          title={picker.kind === 'album'
            ? `${playableTracks.length} ${playableTracks.length === 1 ? 'track' : 'tracks'} from ${album.title}`
            : picker.track.title}
          onClose={() => setPicker(null)}
          onSaved={name => { setPicker(null); setSavedNote(name); }}
        />
      )}

      {playable === 0 && tracks.length === 0 && (
        <div className="empty-state">No files have been imported for this album yet.</div>
      )}
      {playable === 0 && tracks.length > 0 && (
        <div className="empty-state">None of this album's tracks have audio files on the server yet. If a download finished but nothing appears, open Downloads: the music service lists why it could not import it.</div>
      )}

      {tracks.length > 0 && (
        <div className="album-tracks">
          <div className="album-tracks-list">
            {tracks.map((track, position) => {
              const i = playableTracks.indexOf(track);
              return (
              <button
                key={track.id}
                type="button"
                disabled={!track.hasFile}
                className={`album-track-row${isActiveTrack(track) ? ' is-active' : ''}${track.hasFile ? '' : ' is-missing'}`}
                onClick={() => playQueue(queue, i)}
              >
                <span className="album-track-num">{isActiveTrack(track) ? <SvgIcon name="play" size={12} /> : track.trackNumber ?? String(position + 1)}</span>
                <span className="album-track-title">{track.title}</span>
                {track.hasFile ? ((track.audioLabel ?? track.quality) && <span className={`album-track-quality${track.channels === 1 ? ' is-mono' : ''}`} title={track.channels === 1 ? 'Mono recording. Search again for a stereo copy.' : undefined}>{track.audioLabel ?? track.quality}</span>) : <span className="album-track-quality">Not downloaded</span>}
                <span className="album-track-dur">
                  {track.durationMs ? `${Math.floor(track.durationMs / 60000)}:${String(Math.floor((track.durationMs % 60000) / 1000)).padStart(2, '0')}` : ''}
                </span>
                <span
                  className="album-track-save"
                  role="button"
                  tabIndex={0}
                  aria-label={`Save ${track.title} to a playlist`}
                  onClick={e => { e.stopPropagation(); setSavedNote(null); setPicker({ kind: 'track', track }); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setSavedNote(null); setPicker({ kind: 'track', track }); } }}
                >
                  <SvgIcon name="plus" size={16} />
                </span>
              </button>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}