import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MediaCard } from '../components/media/MediaCard';
import { api, type MediaItem } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';
import { ScanButton } from '../components/media/ScanButton';
import { LibraryControls, useLibraryView } from '../components/media/LibraryControls';

export default function Movies() {
  const navigate = useNavigate();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lib = useLibraryView(items, 'movies');
  const surprise = () => {
    const pool = lib.shown.filter(i => i.status === 'available');
    const pick = (pool.length ? pool : lib.shown)[Math.floor(Math.random() * (pool.length || lib.shown.length))];
    if (pick) navigate(`/movies/${pick.id}`);
  };

  useEffect(() => {
    api.movies()
      .then(setItems)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="page">

      <BackButton to="/" label="Home" />
      <div className="page-head">
        <h1>Movies</h1>
        <div className="page-head-actions">
          {!loading && !error && <span className="page-count">{items.length} in library</span>}
          <ScanButton type="movie" />
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate('/search')}>
            Request a title
          </button>
        </div>
      </div>

      {loading && <div className="loading-state">Loading movies...</div>}
      {error && <div className="loading-state">Could not load movies: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="loading-state">No movies in your library yet. Connect your Movies service and it will fill in.</div>
      )}

      {!loading && !error && items.length > 0 && (
        <LibraryControls view={lib.view} setView={lib.setView} genres={lib.genres} studios={lib.studios} collections={lib.collections} letters={lib.letters} total={items.length} shown={lib.shown.length} onSurprise={surprise} />
      )}

      {!loading && !error && items.length > 0 && lib.shown.length === 0 && <div className="empty-state">Nothing matches these filters.</div>}

      {!loading && !error && lib.shown.length > 0 && (
        <div className="media-grid">
          {lib.shown.map(item => (
            <MediaCard key={item.id} item={item} showStatus progress={item.watchProgress} to={`/movies/${item.id}`} />
          ))}
        </div>
      )}
    </main>
  );
}
