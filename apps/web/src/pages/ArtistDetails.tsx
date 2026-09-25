import { DownloadPanel } from '../components/media/DownloadPanel';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';
import { FavoriteButton } from '../components/media/UserFlagButtons';
import { RemoveTitle } from '../components/media/RemoveTitle';
import { TitleQuality } from '../components/media/TitleQuality';
import { SearchAgain } from '../components/media/SearchAgain';
import { UpgradeQuality } from '../components/media/UpgradeQuality';
import { YoutubeFinder } from '../components/media/YoutubeFinder';
import { ArtistVideos } from '../components/media/ArtistVideos';
import { useMusicPlayer } from '../components/media/MusicProvider';
import { artistMix } from '../lib/instant-mix';
import { api, type AlbumItem, type ApiError, type CoverCandidate, type MediaItem } from '../lib/api';

export default function ArtistDetails() {
  const { id } = useParams<{ id: string }>();
  const [artist, setArtist] = useState<MediaItem | null>(null);
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [covers, setCovers] = useState<CoverCandidate[]>([]);
  const [chosenCover, setChosenCover] = useState<string | null>(null);
  const [pickingCover, setPickingCover] = useState(false);
  const [savingCover, setSavingCover] = useState(false);
  const [missing, setMissing] = useState(false);
  const [coversError, setCoversError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ytOpen, setYtOpen] = useState(false);
  const [videosKey, setVideosKey] = useState(0);
  useEffect(() => { api.authStatus().then(st => setIsAdmin(st.user?.role === 'admin')).catch(() => {}); }, []);
  const [findingMore, setFindingMore] = useState(false);
  const [moreNote, setMoreNote] = useState<string | null>(null);
  const [brokenCovers, setBrokenCovers] = useState<Set<string>>(new Set());
  const { playQueue } = useMusicPlayer();
  const [mixing, setMixing] = useState(false);
  const [mixNote, setMixNote] = useState<string | null>(null);
  // A 404 means the artist is genuinely not in the Music service library;
  // any other failure (Lidarr offline, timeout) is a real error worth showing.
  const [loadFailed, setLoadFailed] = useState<{ message: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setMissing(false);
    setArtist(null);
    setAlbums([]);
    api.artist(id)
      .then(a => { if (!cancelled) setArtist(a || null); })
      .catch(err => {
        if (!cancelled) {
          if ((err as ApiError).status === 404) {
            setMissing(true);
          } else {
            setLoadFailed({ message: err instanceof Error ? err.message : 'Could not load this artist.' });
          }
        }
      });
    api.artistAlbums(id)
      .then(({ albums }) => { if (!cancelled) setAlbums(albums); })
      .catch(() => {});
    api.artistCovers(id)
      .then(r => { if (!cancelled) { setCovers(r.candidates); setChosenCover(r.chosen); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  const chooseCover = async (url: string) => {
    if (!id) return;
    setSavingCover(true);
    setCoversError(null);
    try {
      const result = await api.chooseArtistCover(id, url);
      setChosenCover(result.chosen);
      setArtist(prev => prev ? { ...prev, artwork: { ...prev.artwork, poster: result.chosen } } : prev);
      setPickingCover(false);
    } catch (err) {
      setCoversError((err as Error).message);
    } finally {
      setSavingCover(false);
    }
  };

  const findMoreCovers = async () => {
    if (!id) return;
    setFindingMore(true); setMoreNote(null); setCoversError(null);
    try {
      const r = await api.moreArtistCovers(id);
      setCovers(r.candidates);
      setMoreNote(r.added > 0 ? `Found ${r.added} more.` : 'Nothing new was found for this artist.');
    } catch (err) {
      setCoversError(err instanceof Error ? err.message : 'Could not look for more artwork.');
    } finally {
      setFindingMore(false);
    }
  };

  const startMix = async () => {
    if (!artist) return;
    setMixing(true);
    setMixNote(null);
    try {
      const queue = await artistMix(artist);
      if (queue.length === 0) setMixNote('No playable tracks for this artist yet.');
      else playQueue(queue, 0);
    } catch (err) {
      setMixNote((err as Error).message);
    } finally {
      setMixing(false);
    }
  };

  const displayCover = artist?.artwork?.poster;

  return (
    <main className="page">
      <BackButton to="/music" label="Music" />

      {missing && <div className="empty-state">This artist is not in your Music service library. It may have been removed.</div>}
      {loadFailed && <div className="error-state" role="alert">{loadFailed.message}</div>}
      {!artist && !missing && !loadFailed && <div className="loading-state">Loading artist...</div>}

      {artist && (
        <>
          <div className="artist-hero">
            {displayCover && (
              <img className="artist-hero-cover" src={displayCover} alt={`${artist.title} artwork`} loading="lazy" />
            )}
            <div className="artist-hero-info">
              <h1 className="detail-title">{artist.title}</h1>
              {artist.genres?.length ? <p className="artist-hero-genres">{artist.genres.slice(0, 4).join(' · ')}</p> : null}
              <p className="detail-overview">{artist.overview || 'Artist details are not available yet. Connect your Music service for the full library.'}</p>
              {/^lidarr-/.test(artist.id) && <DownloadPanel mediaId={artist.id} />}
              <div className="hero-actions">
                <FavoriteButton mediaType="artist" mediaId={artist.id} initial={artist.favorite} />
                <RemoveTitle kind="artist" id={artist.id} title={artist.title} />
              </div>
              <div className="detail-meta">
                <span>{artist.albumCount ?? albums.length} albums</span>
                <span>{artist.trackFileCount ?? 0} tracks available</span>
                {artist.totalTrackCount ? <span>{artist.totalTrackCount} tracks expected</span> : null}
                {artist.sizeOnDisk ? <span>{(artist.sizeOnDisk / 1024 / 1024 / 1024).toFixed(1)} GB</span> : null}
                <span>{artist.status === 'available' ? 'Library files available' : 'Missing files'}</span>
              </div>
              {/^lidarr-/.test(artist.id) && artist.status === 'available' && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void startMix()} disabled={mixing}>
                  {mixing ? 'Building mix...' : 'Instant mix'}
                </button>
              )}
              {/^lidarr-/.test(artist.id) && (artist.trackFileCount ?? 0) < (artist.totalTrackCount ?? 0) && (
                <SearchAgain label="Search missing albums" run={() => api.searchArtist(artist.id)} small={false} />
              )}
              {/^lidarr-/.test(artist.id) && (artist.trackFileCount ?? 0) > 0 && <UpgradeQuality artistId={artist.id} />}
              {mixNote && <span className="notice notice--err">{mixNote}</span>}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickingCover(v => !v)} aria-expanded={pickingCover}>
                {chosenCover ? 'Change artwork' : 'Choose artwork'}
              </button>
            </div>
          </div>

          {/^lidarr-/.test(artist.id) && <TitleQuality mediaType="artist" id={artist.id} />}

          {pickingCover && (
            <div className="cover-picker">
              <div className="cover-picker-head">
                <h3 className="rail-title">Choose artwork</h3>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void findMoreCovers()} disabled={findingMore}>
                  {findingMore ? 'Looking...' : 'Find more artwork'}
                </button>
              </div>
              {moreNote && <p className="cover-picker-empty" role="status">{moreNote}</p>}
              {covers.length === 0 ? (
                <p className="cover-picker-empty">
                  No artwork was found for this artist yet. Press "Find more artwork" to look on Deezer, Apple Music, Wikipedia and MusicBrainz (needs internet access on the server).
                </p>
              ) : (
                (['artist', 'album'] as const).map(kind => {
                  const group = covers.filter(c => (c.kind ?? 'artist') === kind && !brokenCovers.has(c.url));
                  if (group.length === 0) return null;
                  return (
                    <div key={kind}>
                      <h4 className="cover-picker-group">{kind === 'artist' ? 'Artist photos' : 'Album covers'}</h4>
                      <div className="cover-picker-grid">
                        {group.map(c => (
                          <button
                            key={c.url}
                            type="button"
                            className={`cover-picker-item${chosenCover === c.url ? ' is-chosen' : ''}`}
                            onClick={() => void chooseCover(c.url)}
                            disabled={savingCover}
                          >
                            <img src={c.preview ?? c.url} alt={c.label ?? c.source} loading="lazy" onError={() => setBrokenCovers(prev => new Set(prev).add(c.url))} />
                            <span className="cover-picker-label">{c.label ?? c.source}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
              {coversError && <div className="notice notice--err">{coversError}</div>}
            </div>
          )}

          <div className="album-section">
            <div className="rail-head">
              <h2 className="rail-title">Albums</h2>
              {albums.length > 0 && <span className="page-count">{albums.length} albums</span>}
            </div>
            {albums.length === 0 ? (
              <div className="empty-state">No albums for this artist yet.</div>
            ) : (
              <div className="album-grid">
                {albums.map(album => (
                  <Link key={album.id} className="album-card" to={`/albums/${album.id}`}>
                    <div className="album-card-cover">
                      {album.artwork?.cover
                        ? <img src={album.artwork.cover} alt={`${album.title} cover`} loading="lazy" />
                        : <div className="album-card-placeholder">{artist.title[0]}</div>}
                    </div>
                    <span className="album-card-title">{album.title}</span>
                    <span className="album-card-sub">
                      {album.releaseDate ? `${album.releaseDate.slice(0, 4)}` : ''}{album.albumType ? ` · ${album.albumType}` : ''}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/^lidarr-/.test(artist.id) && <ArtistVideos artistId={artist.id} artistName={artist.title} refreshKey={videosKey} />}
          {/^lidarr-/.test(artist.id) && isAdmin && (
            <div className="album-section">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setYtOpen(v => !v)} aria-expanded={ytOpen}>
                {ytOpen ? 'Hide YouTube search' : 'Find concerts and videos on YouTube'}
              </button>
              {ytOpen && <YoutubeFinder initialQuery={`${artist.title} live concert`} fixedArtist={artist.title} onDownloaded={() => setVideosKey(k => k + 1)} />}
            </div>
          )}
        </>
      )}
    </main>
  );
}