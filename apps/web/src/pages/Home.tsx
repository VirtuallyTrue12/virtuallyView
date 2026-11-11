import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hero } from '../components/media/Hero';
import { MediaRail } from '../components/media/MediaRail';
import { api, type Dashboard, type Rail } from '../lib/api';
import { SetupChecklist } from '../components/home/SetupChecklist';
import { HomeLayoutEditor } from '../components/home/HomeLayoutEditor';
import { Dialog } from '../components/ui/Dialog';
import '../components/home/PersonalRails.css';
import KidsHome from '../components/kids/KidsHome';
import { LoadError, SkeletonGrid, SkeletonRail } from '../components/home/Skeletons';

/** December and January: the year that just ended, or the one that is ending. */
const reviewYear = (now = new Date()) => (now.getMonth() === 11 ? now.getFullYear() : now.getMonth() === 0 ? now.getFullYear() - 1 : null);

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(() => api.cached.dashboard() ?? null);
  // The rails in the viewer's order, hidden ones included, so the editor can list them.
  const [rails, setRails] = useState<Rail[]>(() => api.cached.dashboard()?.rails ?? []);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  const applyDashboard = (json: Dashboard) => {
    setData(json);
    setRails(json.rails);
  };

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.dashboard()
      .then(json => {
        if (!cancelled) applyDashboard(json);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Save the new order and hidden flags. The page follows the change at once; a failed save puts it back.
  const saveLayout = async (next: Rail[]) => {
    const previous = rails;
    setRails(next);
    setLayoutError(null);
    try {
      await api.saveHomeLayout(next.map((rail, position) => ({ id: rail.id, hidden: rail.hidden === true, position })));
    } catch {
      setRails(previous);
      setLayoutError('Your home layout could not be saved. Try again in a moment.');
    }
  };

  const resetLayout = async () => {
    setLayoutError(null);
    try {
      await api.saveHomeLayout([]);
      applyDashboard(await api.dashboard());
    } catch {
      setLayoutError('Your home layout could not be reset. Try again in a moment.');
    }
  };

  return (
    <div className="home">
      {error && <main className="page"><LoadError what="Home" message={error} onRetry={() => setAttempt(a => a + 1)} /></main>}
      {!data && !error && document.documentElement.classList.contains('kids') && (
        <main className="kids-home" aria-busy="true" aria-label="Loading home">
          <div className="skeleton browse-skel-heading" />
          <SkeletonGrid count={6} className="kids-tiles" />
        </main>
      )}
      {!data && !error && !document.documentElement.classList.contains('kids') && (
        <div aria-busy="true" aria-label="Loading home">
          <div className="hero browse-hero-skel" aria-hidden="true" />
          <main className="page"><SkeletonRail /><SkeletonRail /></main>
        </div>
      )}
      {data?.kids && <KidsHome rails={data.rails} />}
      {data && !data.kids && (
        <>
          <Hero items={data.heroCandidates ?? [data.hero]} />
          <main className="page home-rails">
            <SetupChecklist />
            {reviewYear() !== null && (
              <Link to={`/music/year/${reviewYear()}`} className="home-year-card">
                <span className="home-year-kicker">Look back</span>
                <strong>Your {reviewYear()} in review</strong>
                <span>Hours, favourites and your longest binge.</span>
              </Link>
            )}
            {rails.filter(rail => !rail.hidden).map(rail => (
              <MediaRail key={rail.id} rail={rail} />
            ))}
            <div className="home-edit-bar">
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>Edit home</button>
            </div>
          </main>
          <Dialog open={editing} onClose={() => setEditing(false)} title="Edit home">
            <HomeLayoutEditor
              rails={rails}
              onSave={next => void saveLayout(next)}
              onReset={() => void resetLayout()}
              onDone={() => setEditing(false)}
              error={layoutError}
            />
          </Dialog>
        </>
      )}
    </div>
  );
}
