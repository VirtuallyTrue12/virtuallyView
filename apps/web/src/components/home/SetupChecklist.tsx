import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SetupStatus } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

const DISMISS = 'vv-setup-dismissed';

/** Shown to administrators until the basics work, so "request a movie" does not silently do nothing. */
export function SetupChecklist() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(DISMISS) === '1'; } catch { return false; } });

  useEffect(() => { api.setupStatus().then(setStatus).catch(() => {}); }, []);
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
            {!i.ok && <Link className="btn btn-primary btn-sm" to={i.href}>{i.id === 'indexers' ? 'Add an indexer' : i.id === 'request' ? 'Search' : 'Open settings'}</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}
