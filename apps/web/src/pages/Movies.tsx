import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MediaCard } from '../components/media/MediaCard';
import { api, type MediaItem } from '../lib/api';
import { EmptyState, PageHeader } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';
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

      <PageHeader
        title="Movies"
        sub={!loading && !error ? `${items.length} in your library` : undefined}
        actions={<>
          <button className="btn btn-primary" type="button" onClick={() => navigate('/search')}><SvgIcon name="plus" size={17} /> Request a title</button>
          <ScanButton type="movie" />
        </>}
      />

      {loading && <div className="loading-state">Loading movies...</div>}
      {error && <div className="loading-state">Could not load movies: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <EmptyState icon="film" title="No movies yet" text="Request a title and it will search, download and appear here by itself. Or connect an existing Movies service." action={<button className="btn btn-primary" type="button" onClick={() => navigate('/search')}>Find a movie</button>} />
      )}

      {!loading && !error && items.length > 12 && (
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
