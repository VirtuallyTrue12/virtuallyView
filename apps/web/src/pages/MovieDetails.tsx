import { DownloadPanel } from '../components/media/DownloadPanel';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MediaCard } from '../components/media/MediaCard';
import PlyrPlayer from '../components/media/PlyrPlayer';
import { SourceCheck } from '../components/media/SourceCheck';
import { StatusPill } from '../components/media/StatusPill';
import { BackButton } from '../components/layout/BackButton';
import { api, type MediaDescription, type MediaItem } from '../lib/api';
import { useRequester } from '../lib/useRequester';
import { FavoriteButton, WatchedButton } from '../components/media/UserFlagButtons';
import { SearchAgain } from '../components/media/SearchAgain';
import { MediaInfoPanel } from '../components/media/MediaInfoPanel';
import { QualitySelect } from '../components/requests/QualitySelect';
import { TitleQuality } from '../components/media/TitleQuality';
import { SvgIcon } from '../components/ui/SvgIcon';

export default function MovieDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<MediaItem | null>(null);
  const [library, setLibrary] = useState<MediaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const requester = useRequester(outcome => {
    setNotice({ tone: outcome.kind === 'ok' ? 'ok' : 'err', text: outcome.message });
  });
  const requestBusy = requester.busy;
  const [description, setDescription] = useState<MediaDescription | null>(null);
  // When the request lookup finds several titles, the server returns them with
  // a 409 so the user picks the exact release instead of guessing.
  const [watchProgress, setWatchProgress] = useState<{ positionSeconds: number; durationSeconds: number; percent: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [castLoading, setCastLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setError(null);
    setDescription(null);
    api.movie(id)
      .then(m => {
        if (cancelled) return;
        setMovie(m);
        // The library item may not carry cast (Radarr exposes credits only for
        // some titles), or may carry names without portraits. Enrich from the
        // local cast cache / TMDB scrape so the detail page tries to show the
        // main actors with photos even when Radarr returned a bare list.
        if (!m.cast?.length || !m.cast.some(actor => actor.photo)) {
          setCastLoading(true);
          api.movieCast(id)
            .then(cast => {
              if (cancelled) return;
              setMovie(prev => prev ? { ...prev, cast } : prev);
            })
            .catch(() => {})
            .finally(() => { if (!cancelled) setCastLoading(false); });
        }
      })
      .catch(err => { if (!cancelled) setError(err.message); });
    api.movies()
      .then(items => { if (!cancelled) setLibrary(items); })
      .catch(() => {});
    api.mediaDescription(id)
      .then(desc => { if (!cancelled) setDescription(desc); })
      .catch(() => {});
    api.progress('movie', id)
      .then(p => {
        // Only meaningful progress (past the first minute, not near the end)
        // offers a resume point worth showing.
        if (!cancelled && p.percent > 1 && p.percent < 96) setWatchProgress(p);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  if (error) {
    return (
      <main className="page">
        <div className="loading-state">
          <Link to="/movies" className="btn btn-secondary">Back to Movies</Link>
          <p>Could not load this movie: {error}</p>
        </div>
      </main>
    );
  }

  if (!movie) {
    return <main className="page"><div className="loading-state">Loading movie...</div></main>;
  }

  const similar = library
    .filter(m => m.id !== movie.id)
    .filter(m => m.genres?.some(g => movie.genres?.includes(g)) ?? false)
    .slice(0, 8);
  const sharedGenres = movie.genres?.length ? (movie.genres.length > 3 ? movie.genres.slice(0, 3) : movie.genres) : [];
  const inLibrary = movie.status === 'available' || movie.status === 'downloading';

  const addToLibrary = () => {
    if (inLibrary) {
      setNotice({ tone: 'ok', text: `"${movie.title}" is already available in your library.` });
      return;
    }
    // A movie already tracked by Radarr carries its exact TMDB id, so the
    // request cannot fail on title ambiguity.
    const tmdb = (movie as { tmdbId?: number | string }).tmdbId;
    setNotice({ tone: 'ok', text: `Looking up "${movie.title}"…` });
    void requester.submit({
      title: movie.title, mediaType: 'movie',
      ...(movie.year ? { year: movie.year } : {}),
      ...(tmdb ? { selectedProviderId: String(tmdb) } : {})
    });
  };

  const replaceFile = async () => {
    setReplacing(true);
    try {
      const result = await api.replaceMovieFile(movie.id);
      setNotice({ tone: 'ok', text: result.message });
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
    } finally {
      setReplacing(false);
    }
  };

  // Deleting a movie needs a deliberate two-step confirmation so one stray
  // click cannot wipe a download the user has waited hours for.
  const removeMovie = async (deleteFiles: boolean) => {
    setDeleting(true);
    setNotice({ tone: 'ok', text: deleteFiles ? `Removing "${movie.title}" from the library and deleting its files…` : `Removing "${movie.title}" from the library…` });
    try {
      await api.deleteMovie(movie.id, deleteFiles);
      setNotice({ tone: 'ok', text: `"${movie.title}" was removed from your library.` });
      window.setTimeout(() => navigate('/movies'), 900);
    } catch (err) {
      setNotice({ tone: 'err', text: (err as Error).message });
      setDeleting(false);
    }
  };

  return (
    <main className="detail">
      <section className="detail-hero">
        {movie.artwork?.backdrop ? (
          <img className="detail-backdrop" src={movie.artwork.backdrop} alt="" />
        ) : (
          <div className="detail-backdrop detail-backdrop--placeholder" />
        )}
        <div className="detail-overlay" aria-hidden="true" />

        <div className="detail-body">
          <BackButton to="/movies" label="Movies" />
          <div className="detail-main">
            <div className="detail-poster">
              {movie.artwork?.poster && (
                <img src={movie.artwork.poster} alt={`${movie.title} poster`} />
              )}
            </div>
            <div className="detail-info">
              <h1 className="detail-title">{movie.title}</h1>
              {movie.tagline && <p className="detail-tagline">{movie.tagline}</p>}

              <div className="detail-meta">
                {movie.year && <span>{movie.year}</span>}
                {movie.runtime && <span>{movie.runtime} min</span>}
                {movie.rating ? <span className="rating"><SvgIcon name="star" size={14} /> {movie.rating.toFixed(1)}</span> : null}
                {movie.quality && <span>{movie.quality}</span>}
                {movie.language && <span>{movie.language}</span>}
                {movie.certification && <span className="cert-badge">{movie.certification}</span>}
                {movie.studio && <Link to={`/movies?studio=${encodeURIComponent(movie.studio)}`}>{movie.studio}</Link>}
                {movie.collection && <Link to={`/movies?collection=${encodeURIComponent(movie.collection)}`}>{movie.collection}</Link>}
              </div>

              {sharedGenres.length > 0 && (
                <div className="genres">
                  {sharedGenres.map(g => <span key={g}>{g}</span>)}
                </div>
              )}

              {movie.overview && <p className="detail-overview">{movie.overview}</p>}
              {/^radarr-/.test(movie.id) && <DownloadPanel mediaId={movie.id} />}

              <div className="hero-actions">
                {movie.status === 'available' && (
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => navigate(`/movies/${movie.id}/play`)}
                  >
                    {watchProgress ? 'Resume' : 'Play'}
                  </button>
                )}
                {watchProgress && movie.status === 'available' && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => navigate(`/movies/${movie.id}/play`)}
                  >
                    Play from start
                  </button>
                )}
                {(movie.status === 'missing' || movie.status === 'requested') && <QualitySelect mediaType="movie" compact />}
                {(movie.status === 'missing' || movie.status === 'requested') && (
                  <button className="btn btn-primary" type="button" onClick={addToLibrary} disabled={requestBusy}>
                    {requestBusy ? 'Looking it up…' : movie.status === 'requested' ? 'Requested' : 'Request'}
                  </button>
                )}
                <FavoriteButton mediaType="movie" mediaId={movie.id} initial={(movie as { favorite?: boolean }).favorite} />
                {movie.status === 'available' && (
                  <WatchedButton mediaType="movie" mediaId={movie.id} initial={(movie as { watched?: boolean }).watched} onChange={w => { if (w) setWatchProgress(null); }} />
                )}
                <button
                  className="btn btn-danger-outline"
                  type="button"
                  onClick={() => setConfirmDelete(v => !v)}
                  disabled={deleting}
                  aria-expanded={confirmDelete}
                >
                  {deleting ? 'Removing…' : confirmDelete ? 'Cancel' : inLibrary ? 'Delete movie' : 'Remove title'}
                </button>
                {confirmDelete && !deleting && (
                  <span className="detail-delete-confirm">
                    <span>{inLibrary ? 'Remove from library?' : 'Remove this title from your list?'}</span>
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => removeMovie(false)}>
                      {inLibrary ? 'Remove, keep files' : 'Remove from list'}
                    </button>
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => removeMovie(true)}>
                      Remove and delete files
                    </button>
                  </span>
                )}
              </div>
              {movie.status !== 'available' && /^radarr-/.test(movie.id) && (
                <SearchAgain label="Search again" run={() => api.searchMovie(movie.id)} small={false} />
              )}
              {movie.warnings?.map(warning => (
                <div key={warning.code + warning.message} className="notice notice--err title-warning" role="alert">
                  <span>{warning.message}</span>
                  {warning.code === 'suspect-file' && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void replaceFile()} disabled={replacing}>
                      {replacing ? 'Replacing...' : 'Replace this file'}
                    </button>
                  )}
                </div>
              ))}
              {notice && <div className={`notice notice--${notice.tone}`}>{notice.text}</div>}

              {requester.picker}
            </div>
          </div>
        </div>
      </section>

      {movie.streamUrl && (
        <section className="page detail-trailer-section">
          <div className="rail-head">
            <h2 className="rail-title">Preview</h2>
          </div>
          <div className="detail-trailer-embed">
            <PlyrPlayer
              source={{ type: 'video', src: movie.streamUrl, poster: movie.artwork?.backdrop }}
              className="detail-trailer-video"
              controls
            />
          </div>
        </section>
      )}

      {(description?.description || movie.overview) && (
        <section className="page detail-story-section">
          <div className="rail-head">
            <h2 className="rail-title">Storyline</h2>
          </div>
          <p className="detail-story">
            {description?.description || movie.overview}
          </p>
          {description && description.source !== 'library' && (
            <span className="detail-story-source">Description pulled from {description.source}</span>
          )}
        </section>
      )}

      {movie.cast && movie.cast.length > 0 ? (
        <section className="page detail-cast-section">
          <div className="rail-head">
            <h2 className="rail-title">Cast</h2>
          </div>
          <div className="cast-list">
            {movie.cast.map((actor, i) => (
              <Link className="cast-card" key={i} to={`/people/${encodeURIComponent(actor.name)}`}>
                {actor.photo ? (
                  <img className="cast-portrait" src={actor.photo} alt={actor.name} loading="lazy" />
                ) : (
                  <div className="cast-portrait cast-portrait--fallback">
                    <span className="cast-initials">{actor.name.split(' ').map(n => n[0]).join('')}</span>
                  </div>
                )}
                <div className="cast-caption">
                  <span className="cast-name">{actor.name}</span>
                  <span className="cast-role">{actor.role}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : castLoading ? (
        <section className="page detail-cast-section">
          <div className="rail-head">
            <h2 className="rail-title">Cast</h2>
          </div>
          <p className="detail-story-source">Looking up the main actors…</p>
        </section>
      ) : null}

      {/^radarr-/.test(movie.id) && <TitleQuality mediaType="movie" id={movie.id} />}

      {movie.status === 'available' && (
        <section className="page">
          <div className="rail-head"><h2 className="rail-title">Media info</h2></div>
          <MediaInfoPanel load={() => api.mediaInfo(movie.id)} />
        </section>
      )}

      {movie.status && (
        <section className="page detail-status-section">
          <div className="rail-head">
            <h2 className="rail-title">Status</h2>
          </div>
          <div className="detail-status-row">
            <StatusPill status={movie.status} />
            <span className="detail-status-text">
              {movie.status === 'available' ? 'Files are in your library and ready to watch.' :
               movie.status === 'downloading' ? 'A file is being downloaded or imported right now.' :
               movie.status === 'requested' ? 'This title has been requested and will appear here when it is available.' :
               movie.status === 'paused' ? 'The transfer for this title is paused.' :
               'This title is not in your library yet. Use Request to add it.'}
            </span>
          </div>
        </section>
      )}

      {movie.director && movie.director.length > 0 && (
        <section className="page detail-director-section">
          <div className="detail-director-row">
            <span className="detail-director-label">Director{movie.director.length > 1 ? 's' : ''}</span>
            <span className="detail-director-names">{movie.director.map(d => d.name).join(', ')}</span>
          </div>
          {movie.releaseDate && (
            <div className="detail-director-row">
              <span className="detail-director-label">Release Date</span>
              <span className="detail-director-names">{movie.releaseDate}</span>
            </div>
          )}
        </section>
      )}

      <section className="page detail-sources-section">
        <SourceCheck id={movie.id} />
      </section>

      {similar.length > 0 && (
        <section className="page">
          <div className="rail-head">
            <h2 className="rail-title">More Like This</h2>
          </div>
          <div className="rail-scroll">
            {similar.map(m => (
              <MediaCard key={m.id} item={m} to={`/movies/${m.id}`} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}