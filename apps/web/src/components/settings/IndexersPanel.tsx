import { useCallback, useEffect, useState } from 'react';
import { api, type BulkIndexers, type Indexer, type IndexerDefinition } from '../../lib/api';

/** Indexers decide where downloads come from. Without one, requests find nothing. */
export default function IndexersPanel() {
  const [configured, setConfigured] = useState<Indexer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<IndexerDefinition[]>([]);
  const [totalPublic, setTotalPublic] = useState(0);
  const [totalAdult, setTotalAdult] = useState(0);
  const [showAdult, setShowAdult] = useState(false);
  const [adultCatalog, setAdultCatalog] = useState<IndexerDefinition[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkIndexers | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setConfigured((await api.indexers()).indexers); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.indexerCatalog(query).then(r => { if (alive) { setCatalog(r.indexers); setTotalPublic(r.totalPublic); setTotalAdult(r.totalAdult ?? 0); } }).catch(() => { if (alive) setCatalog([]); });
      if (showAdult) api.indexerCatalog(query, true).then(r => { if (alive) setAdultCatalog(r.indexers); }).catch(() => { if (alive) setAdultCatalog([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query, showAdult]);

  const act = async (key: string, fn: () => Promise<{ success: boolean; message: string }>) => {
    setBusy(key);
    setNote(null);
    try { const r = await fn(); setNote({ tone: r.success ? 'ok' : 'err', text: r.message }); await load(); }
    catch (e) { setNote({ tone: 'err', text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  useEffect(() => {
    if (bulk?.state !== 'running') return;
    const t = setInterval(() => {
      api.bulkIndexerStatus().then(next => { setBulk(next); if (next.state !== 'running') void load(); }).catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [bulk?.state, load]);

  const enableAll = async () => {
    setNote(null);
    try { setBulk(await api.enableAllPublicIndexers()); } catch (e) { setNote({ tone: 'err', text: (e as Error).message }); }
  };

  const have = new Set((configured ?? []).map(i => i.definitionName));

  const renderRow = (d: IndexerDefinition) => (
    <li className="users-row" key={d.definitionName}>
      <span className="users-name">{d.name}{d.adult && <span className="indexer-adult-badge">18+</span>}<small style={{ display: 'block', opacity: 0.7 }}>{d.protocol}{d.language ? `, ${d.language}` : ''}{d.description ? `. ${d.description.slice(0, 90)}` : ''}</small></span>
      <span className="users-actions">
        {have.has(d.definitionName)
          ? <span className="users-you">added</span>
          : <button className="btn btn-primary btn-sm" type="button" disabled={busy === d.definitionName} onClick={() => void act(d.definitionName, () => api.addIndexer(d.definitionName))}>{busy === d.definitionName ? 'Adding...' : 'Add'}</button>}
      </span>
    </li>
  );

  return (
    <>
      <section className="settings-section">
        <h3 className="section-title">Your indexers</h3>
        <p className="model-suggest-meta">
          Indexers are the sources Radarr, Sonarr and Lidarr search when you request something. Add only sources you are entitled to use.
          Prowlarr shares them with the media services automatically.
        </p>
        {error && <div className="notice notice--err">{error}. Check that Prowlarr is connected under Settings &gt; Services.</div>}
        {configured && configured.length === 0 && <div className="notice notice--err">No indexers yet. Requests will find nothing until you add one below.</div>}
        <ul className="users-list">
          {(configured ?? []).map(i => (
            <li className="users-row" key={i.id}>
              <span className="users-name">{i.name}<small style={{ display: 'block', opacity: 0.7 }}>{i.protocol}, {i.privacy}{i.enabled ? '' : ', disabled'}</small>
                {i.failingUntil && <small className="indexer-failing">Not answering. Prowlarr skips it until {new Date(i.failingUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} and then tries again.</small>}
              </span>
              <span className="users-actions">
                <button className="btn btn-secondary btn-sm" type="button" disabled={busy === `t${i.id}`} onClick={() => void act(`t${i.id}`, () => api.testIndexer(i.id))}>{busy === `t${i.id}` ? 'Testing, up to 2 min...' : 'Test'}</button>
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
        <div className="notice notice--muted" style={{ marginBottom: 'var(--spacing-sm)' }}>
          <strong>Add every public source that works.</strong> Tests each one and keeps the ones that answer. Adult sources are never included.
          Public sources can carry copyrighted material that is unlawful to obtain where you live: only use what you have the right to use.
          <div style={{ marginTop: 6 }}>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => void enableAll()} disabled={bulk?.state === 'running'}>
              {bulk?.state === 'running' ? `Checking ${bulk.checked} of ${bulk.total}, ${bulk.added} added...` : 'Add all working public sources'}
            </button>
            {bulk?.state === 'done' && <span style={{ marginLeft: 8 }}>Done: {bulk.added} added out of {bulk.total} checked.</span>}
            {bulk?.state === 'failed' && <span style={{ marginLeft: 8 }}>Stopped: {bulk.message}</span>}
          </div>
        </div>
        <input className="settings-input" placeholder="Search indexers" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search indexers" />
        <ul className="users-list" style={{ marginTop: 'var(--spacing-sm)' }}>
          {catalog.map(renderRow)}
          {catalog.length === 0 && <li className="users-row"><span className="users-name">No matches.</span></li>}
        </ul>
        {totalAdult > 0 && (
          <details className="indexer-adult" onToggle={e => setShowAdult((e.target as HTMLDetailsElement).open)}>
            <summary>Adult (18+) sources ({totalAdult})</summary>
            <p className="model-suggest-meta">Sources that only carry adult content. Kept apart so nobody adds one by accident.</p>
            <ul className="users-list">
              {adultCatalog.map(renderRow)}
              {showAdult && adultCatalog.length === 0 && <li className="users-row"><span className="users-name">No matches.</span></li>}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
