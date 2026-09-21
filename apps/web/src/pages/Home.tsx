import { useEffect, useState } from 'react';
import { Hero } from '../components/media/Hero';
import { MediaRail } from '../components/media/MediaRail';
import { api, type Dashboard } from '../lib/api';
import { SetupChecklist } from '../components/home/SetupChecklist';

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.dashboard()
      .then(json => {
        if (!cancelled) setData(json);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="home">
      {error && <div className="loading-state">Dashboard could not be loaded: {error}</div>}
      {!data && !error && <div className="loading-state">Loading dashboard...</div>}
      {data && (
        <>
          <Hero items={data.heroCandidates ?? [data.hero]} />
          <main className="page">
            <SetupChecklist />
            {data.rails.map(rail => (
              <MediaRail key={rail.id} rail={rail} />
            ))}
          </main>
        </>
      )}
    </div>
  );
}