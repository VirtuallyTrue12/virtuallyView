import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SetupStatus } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

const DISMISS = 'vv-setup-dismissed';

/** Shown to administrators until the basics work, so "request a movie" does not silently do nothing. */
export function SetupChecklist() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(DISMISS) === '1'; } catch { return false; } });

  const [fixing, setFixing] = useState(false);
  const [fixNote, setFixNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = () => api.setupStatus().then(setStatus).catch(() => {});
  useEffect(() => { void load(); }, []);

  // One button that runs the same automatic setup as the first start: safe to repeat.
  const setUpForMe = async () => {
    setFixing(true);
    setFixNote(null);
    try {
      const result = await api.setupRepair();
      const last = result.log[result.log.length - 1] ?? '';
      setFixNote(result.ok
        ? { tone: 'ok', text: 'Done. Everything that could be set up automatically is set up.' }
        : { tone: 'err', text: last || 'Some steps could not finish. Check that every service is running, then try again.' });
      await load();
    } catch (err) {
      setFixNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setFixing(false);
    }
  };

  if (!status || status.complete || hidden) return null;

  const done = status.items.filter(i => i.ok).length;
  return (
    <section className="setup-card" aria-label="Setup">
      <div className="setup-head">
        <div>
          <h2>Finish setting up</h2>
          <p>{done} of {status.items.length} done. Downloads only work once every step below is green.</p>
        </div>
        <button type="button" className="setup-dismiss" aria-label="Hide for now" onClick={() => { try { sessionStorage.setItem(DISMISS, '1'); } catch { /* ignore */ } setHidden(true); }}><SvgIcon name="close" size={16} /></button>
      </div>
      <ul>
        {status.items.map(i => (
          <li key={i.id} className={i.ok ? 'is-ok' : ''}>
            <span className="setup-mark" aria-hidden="true">{i.ok ? <SvgIcon name="check" size={14} /> : ''}</span>
            <span className="setup-text"><strong>{i.label}</strong><small>{i.detail}</small></span>
            {!i.ok && i.id === 'indexers' && (
              <span className="setup-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void setUpForMe()} disabled={fixing}>{fixing ? 'Setting up...' : 'Set up for me'}</button>
                <Link className="btn btn-secondary btn-sm" to={i.href}>Choose more</Link>
              </span>
            )}
            {!i.ok && i.id === 'request' && <Link className="btn btn-primary btn-sm" to={i.href}>Search</Link>}
            {!i.ok && (i.id === 'services' || i.id === 'downloader') && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>Check again</button>
            )}
          </li>
        ))}
      </ul>
      {fixNote && <div className={`notice notice--${fixNote.tone}`} role="status">{fixNote.text}</div>}
    </section>
  );
}
