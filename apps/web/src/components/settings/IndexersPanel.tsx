import { useCallback, useEffect, useState } from 'react';
import { api, type Indexer, type IndexerDefinition } from '../../lib/api';

/** Indexers decide where downloads come from. Without one, requests find nothing. */
export default function IndexersPanel() {
  const [configured, setConfigured] = useState<Indexer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<IndexerDefinition[]>([]);
  const [totalPublic, setTotalPublic] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setConfigured((await api.indexers()).indexers); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.indexerCatalog(query).then(r => { if (alive) { setCatalog(r.indexers); setTotalPublic(r.totalPublic); } }).catch(() => { if (alive) setCatalog([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  const act = async (key: string, fn: () => Promise<{ success: boolean; message: string }>) => {
    setBusy(key);
    setNote(null);
    try { const r = await fn(); setNote({ tone: r.success ? 'ok' : 'err', text: r.message }); await load(); }
    catch (e) { setNote({ tone: 'err', text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  const have = new Set((configured ?? []).map(i => i.definitionName));

  return (
    <>
      <section className="settings-section">
        <h3 className="section-title">Your indexers</h3>
        <p className="model-suggest-meta">
          Indexers are the sources Radarr, Sonarr and Lidarr search when you request something. Add only sources you are entitled to use.
          Prowlarr shares them with the media services automatically.
        </p>
        {error && <div className="notice notice--err">{error}. Check that Prowlarr is connected under Integrations.</div>}
        {configured && configured.length === 0 && <div className="notice notice--err">No indexers yet. Requests will find nothing until you add one below.</div>}
        <ul className="users-list">
          {(configured ?? []).map(i => (
            <li className="users-row" key={i.id}>
              <span className="users-name">{i.name}<small style={{ display: 'block', opacity: 0.7 }}>{i.protocol}, {i.privacy}{i.enabled ? '' : ', disabled'}</small></span>
              <span className="users-actions">
                <button className="btn btn-secondary btn-sm" type="button" disabled={busy === `t${i.id}`} onClick={() => void act(`t${i.id}`, () => api.testIndexer(i.id))}>{busy === `t${i.id}` ? 'Testing...' : 'Test'}</button>
                <button className="btn btn-secondary btn-sm" type="button" disabled={busy === `r${i.id}`} onClick={() => void act(`r${i.id}`, () => api.removeIndexer(i.id))}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
        {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
      </section>

      <section className="settings-section">
        <h3 className="section-title">Add a public indexer</h3>
        <p className="model-suggest-meta">
          These need no account ({totalPublic || 'many'} available). For a private tracker, add it in Prowlarr itself so you can enter your own login.
        </p>
        <input className="settings-input" placeholder="Search indexers" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search indexers" />
        <ul className="users-list" style={{ marginTop: 'var(--spacing-sm)' }}>
          {catalog.map(d => (
            <li className="users-row" key={d.definitionName}>
              <span className="users-name">{d.name}<small style={{ display: 'block', opacity: 0.7 }}>{d.protocol}{d.language ? `, ${d.language}` : ''}{d.description ? `. ${d.description.slice(0, 90)}` : ''}</small></span>
              <span className="users-actions">
                {have.has(d.definitionName)
                  ? <span className="users-you">added</span>
                  : <button className="btn btn-primary btn-sm" type="button" disabled={busy === d.definitionName} onClick={() => void act(d.definitionName, () => api.addIndexer(d.definitionName))}>{busy === d.definitionName ? 'Adding...' : 'Add'}</button>}
              </span>
            </li>
          ))}
          {catalog.length === 0 && <li className="users-row"><span className="users-name">No matches.</span></li>}
        </ul>
      </section>
    </>
  );
}
