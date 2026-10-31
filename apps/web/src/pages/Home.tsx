import { useEffect, useState } from 'react';
import { Hero } from '../components/media/Hero';
import { MediaRail } from '../components/media/MediaRail';
import { api, type Dashboard, type Rail } from '../lib/api';
import { SetupChecklist } from '../components/home/SetupChecklist';
import { HomeLayoutEditor } from '../components/home/HomeLayoutEditor';
import { Dialog } from '../components/ui/Dialog';
import '../components/home/PersonalRails.css';
import KidsHome from '../components/kids/KidsHome';

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  // The rails in the viewer's order, hidden ones included, so the editor can list them.
  const [rails, setRails] = useState<Rail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  const applyDashboard = (json: Dashboard) => {
    setData(json);
    setRails(json.rails);
  };

  useEffect(() => {
    let cancelled = false;
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
  }, []);

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
      {error && <div className="loading-state">Dashboard could not be loaded: {error}</div>}
      {!data && !error && <div className="loading-state">Loading dashboard...</div>}
      {data?.kids && <KidsHome rails={data.rails} />}
      {data && !data.kids && (
        <>
          <Hero items={data.heroCandidates ?? [data.hero]} />
          <main className="page">
            <SetupChecklist />
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
              error={layoutError}
            />
            <div className="dlg-actions">
              <button type="button" className="btn btn-primary" onClick={() => setEditing(false)}>Done</button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}
