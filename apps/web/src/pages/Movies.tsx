import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MediaCard } from '../components/media/MediaCard';
import { api, type MediaItem } from '../lib/api';
import { ImportExisting } from '../components/media/ImportExisting';
import { OpenMediaFolder } from '../components/media/OpenMediaFolder';
import { EmptyState, PageHeader } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';
import { ScanButton } from '../components/media/ScanButton';
import { LibraryControls, useLibraryView } from '../components/media/LibraryControls';
import { LoadError, SkeletonGrid } from '../components/home/Skeletons';

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

  const load = () => {
    setLoading(true);
    setError(null);
    api.movies()
      .then(setItems)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <main className="page browse-library">

      <PageHeader
        title="Movies"
        sub={!loading && !error ? `${items.length} in your library` : undefined}
        actions={<>
          <button className="btn btn-primary" type="button" onClick={() => navigate('/search')}><SvgIcon name="plus" size={17} /> Request a title</button>
          <ImportExisting kind="movies" onImported={() => { api.movies().then(setItems).catch(() => undefined); }} />
          <ScanButton type="movie" />
          <OpenMediaFolder kind="movies" />
        </>}
      />

      {loading && <SkeletonGrid />}
      {error && <LoadError what="Movies" message={error} onRetry={load} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState icon="film" title="No movies yet" text="Request a title and it will search, download and appear here by itself. Or connect an existing Movies service." action={<button className="btn btn-primary" type="button" onClick={() => navigate('/search')}>Find a movie</button>} />
      )}

      {!loading && !error && (items.length > 12 || lib.filtered) && (
        <LibraryControls view={lib.view} setView={lib.setView} genres={lib.genres} studios={lib.studios} collections={lib.collections} letters={lib.letters} total={items.length} shown={lib.shown.length} onSurprise={surprise} />
      )}

      {!loading && !error && items.length > 0 && lib.shown.length === 0 && (
        <EmptyState icon="search" title="Nothing matches these filters" action={<button className="btn btn-secondary" type="button" onClick={() => lib.setView(v => ({ ...v, query: '', state: 'all', genre: '', letter: '', studio: '', collection: '' }))}>Clear filters</button>} />
      )}

      {!loading && !error && lib.shown.length > 0 && (
        <div className="media-grid browse-grid">
          {lib.shown.map(item => (
            <MediaCard key={item.id} item={item} showStatus progress={item.watchProgress} to={`/movies/${item.id}`} />
          ))}
        </div>
      )}
    </main>
  );
}
