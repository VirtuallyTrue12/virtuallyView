import { useCallback, useEffect, useState } from 'react';
import { api, type StoragePlan, type StoragePlanTitle } from '../../../lib/api';
import { Dialog } from '../../ui/Dialog';
import { Skeleton } from '../../ui/Skeleton';
import { Pill } from '../../ui/Page';
import { toast } from '../../ui/Toast';

const size = (b: number) => b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e10 ? `${Math.round(b / 1e9)} GB` : `${(b / 1e9).toFixed(1)} GB`;
const DAYS = [30, 90, 180, 365];

/** Free space per folder, what is using it, the biggest titles, and what could go. Administrators only. */
export default function StorageSection() {
  const [plan, setPlan] = useState<StoragePlan | null>(null);
  const [error, setError] = useState('');
  const [days, setDays] = useState(90);
  const [target, setTarget] = useState<StoragePlanTitle | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.storagePlan(days).then(setPlan).catch(e => setError((e as Error).message || 'Could not read storage.'));
  }, [days]);
  useEffect(load, [load]);
  // The first measurement runs in the background; look again until it is there.
  useEffect(() => {
    if (!plan?.scanning) return;
    const t = window.setTimeout(load, 4000);
    return () => window.clearTimeout(t);
  }, [plan, load]);

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.storageDelete(target.id);
      toast(`Deleted "${target.title}" and its files.`);
      setTarget(null);
      load();
    } catch (e) { toast((e as Error).message || 'Could not delete it.'); } finally { setBusy(false); }
  };

  if (error) return <div className="st-block"><p className="ui-help" role="alert">{error}</p><button className="btn btn-secondary" type="button" onClick={load}>Retry</button></div>;
  if (!plan) return <div className="st-block" aria-label="Loading storage"><Skeleton style={{ height: 90 }} /><Skeleton style={{ height: 160, marginTop: 12 }} /></div>;
  const total = plan.categories.reduce((n, c) => n + c.bytes, 0);

  return (
    <div className="st-block sto">
      <h3 className="ui-section-title">Free space</h3>
      <ul className="sto-disks">
        {plan.disks.map(d => {
          const pct = d.totalBytes ? Math.round(d.usedBytes / d.totalBytes * 100) : 0;
          const low = d.freeBytes < 20e9 || pct >= 90;
          return (
            <li key={d.name} className="sto-disk">
              <div className="sto-row"><strong>{d.name}</strong>{low && <Pill tone="warn">Running low</Pill>}</div>
              <div className="sto-bar" role="img" aria-label={`${d.name}: ${pct}% used`}><div className={low ? 'is-low' : ''} style={{ width: `${pct}%` }} /></div>
              <span className="ui-help">{size(d.freeBytes)} free of {size(d.totalBytes)}</span>
            </li>
          );
        })}
      </ul>

      <h3 className="ui-section-title">What is using the space</h3>
      {plan.scanning && !plan.categories.length ? <Skeleton style={{ height: 120 }} /> : (
        <ul className="sto-cats">
          {plan.categories.map(c => (
            <li key={c.id}>
              <div className="sto-row"><span>{c.label}</span><span>{size(c.bytes)}</span></div>
              <div className="sto-bar sto-bar--thin"><div style={{ width: `${total ? Math.max(2, Math.round(c.bytes / total * 100)) : 0}%` }} /></div>
            </li>
          ))}
          {!plan.categories.length && <li className="ui-help">Nothing measured yet.</li>}
        </ul>
      )}

      <h3 className="ui-section-title">Could be deleted</h3>
      <div className="sto-row">
        <p className="ui-help">Everyone who watched it has finished it, and nobody has touched it for</p>
        <select className="settings-input sto-days" value={days} aria-label="Days untouched" onChange={e => setDays(Number(e.target.value))}>
          {DAYS.map(d => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>
      {plan.suggestions.length === 0 ? <p className="ui-help">{plan.scanning ? 'Measuring…' : 'Nothing to suggest right now.'}</p> : (
        <ul className="sto-list">
          {plan.suggestions.slice(0, 30).map(t => (
            <li key={t.id}>
              <span className="sto-name"><strong>{t.title}</strong><em>{t.kind === 'movie' ? 'Movie' : 'Show'}{t.year ? ` · ${t.year}` : ''}{t.lastWatched ? ` · last watched ${new Date(t.lastWatched).toLocaleDateString()}` : ''}</em></span>
              <span className="sto-size">{size(t.bytes)}</span>
              <button className="btn btn-danger" type="button" aria-label={`Delete files for ${t.title}`} onClick={() => setTarget(t)}>Delete files</button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="ui-section-title">Biggest titles</h3>
      {plan.biggest.length === 0 ? <p className="ui-help">{plan.scanning ? 'Measuring…' : 'No movies or shows with files yet.'}</p> : (
        <ul className="sto-list">
          {plan.biggest.map(t => (
            <li key={t.id}>
              <span className="sto-name"><strong>{t.title}</strong><em>{t.kind === 'movie' ? 'Movie' : 'Show'}{t.quality ? ` · ${t.quality}` : ''}</em></span>
              <span className="sto-size">{size(t.bytes)}</span>
              <Pill tone={t.watched ? 'ok' : 'neutral'}>{t.watched ? 'Watched' : 'Not watched'}</Pill>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!target} onClose={() => !busy && setTarget(null)} title="Delete files?">
        {target && (
          <>
            <p>Delete <strong>{target.title}</strong> and free {size(target.bytes)}? Its files are removed from the disk and it will not be downloaded again.</p>
            <div className="sto-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setTarget(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-danger" type="button" onClick={() => void remove()} disabled={busy}>{busy ? 'Deleting…' : `Delete ${target.title}`}</button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
