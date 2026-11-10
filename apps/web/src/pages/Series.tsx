import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MediaCard } from '../components/media/MediaCard';
import { api, type SeriesItem } from '../lib/api';
import { ImportExisting } from '../components/media/ImportExisting';
import { EmptyState, PageHeader } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';
import { ScanButton } from '../components/media/ScanButton';
import { OpenMediaFolder } from '../components/media/OpenMediaFolder';
import { LibraryControls, useLibraryView } from '../components/media/LibraryControls';
import { LoadError, SkeletonGrid } from '../components/home/Skeletons';

export default function Series() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SeriesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lib = useLibraryView(items, 'series');
  const surprise = () => {
    const pool = lib.shown.filter(i => i.status === 'available');
    const pick = (pool.length ? pool : lib.shown)[Math.floor(Math.random() * (pool.length || lib.shown.length))];
    if (pick) navigate(`/series/${pick.id}`);
  };

  const load = () => {
    setLoading(true);
    setError(null);
    api.series()
      .then(setItems)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <main className="page browse-library">

      <PageHeader
        title="TV shows"
        sub={!loading && !error ? `${items.length} in your library` : undefined}
        actions={<>
          <button className="btn btn-primary" type="button" onClick={() => navigate('/search')}><SvgIcon name="plus" size={17} /> Request a title</button>
          <ImportExisting kind="series" onImported={() => { api.series().then(setItems).catch(() => undefined); }} />
          <ScanButton type="series" />
          <OpenMediaFolder kind="tv" />
        </>}
      />

      {loading && <SkeletonGrid />}
      {error && <LoadError what="TV shows" message={error} onRetry={load} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState icon="tv" title="No TV shows yet" text="Request a show and every episode is searched, downloaded and filed for you. Or connect an existing TV service." action={<button className="btn btn-primary" type="button" onClick={() => navigate('/search')}>Find a show</button>} />
      )}

      {!loading && !error && (items.length > 12 || lib.filtered) && (
        <LibraryControls view={lib.view} setView={lib.setView} genres={lib.genres} studios={lib.studios} studioLabel="Network" letters={lib.letters} total={items.length} shown={lib.shown.length} onSurprise={surprise} />
      )}

      {!loading && !error && items.length > 0 && lib.shown.length === 0 && (
        <EmptyState icon="search" title="Nothing matches these filters" action={<button className="btn btn-secondary" type="button" onClick={() => lib.setView(v => ({ ...v, query: '', state: 'all', genre: '', letter: '', studio: '', collection: '' }))}>Clear filters</button>} />
      )}

      {!loading && !error && lib.shown.length > 0 && (
        <div className="media-grid browse-grid">
          {lib.shown.map(item => (
            <MediaCard key={item.id} item={item} showStatus progress={item.watchProgress} to={`/series/${item.id}`} />
          ))}
        </div>
      )}
    </main>
  );
}
