import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatusPill } from '../components/media/StatusPill';
import { RequestActivityFeed } from '../components/requests/RequestActivityFeed';
import { api, type RequestItem } from '../lib/api';
import { lookupRequestCandidates } from '../lib/request-selection';
import { useRequester } from '../lib/useRequester';
import { humanName } from '../lib/integration-names';
import { SvgIcon } from '../components/ui/SvgIcon';
import { ReleasePicker } from '../components/media/ReleasePicker';

const ACTIVE = ['pending', 'searching', 'downloading', 'importing'];
type Filter = 'all' | 'active' | 'failed' | 'done';
const FILTER_LABEL: Record<Filter, string> = { all: 'All', active: 'Active', failed: 'Failed', done: 'Finished' };
const inFilter = (item: RequestItem, f: Filter) =>
  f === 'all' || (f === 'active' && ACTIVE.includes(item.status)) || (f === 'failed' && item.status === 'failed') ||
  (f === 'done' && (item.status === 'available' || item.status === 'cancelled'));

export default function Requests() {
  const navigate = useNavigate();
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmBulk, setConfirmBulk] = useState<'remove' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => { api.authStatus().then(st => setIsAdmin(st.user?.role === 'admin')).catch(() => {}); }, []);
  const retryOf = useRef<string | null>(null);

  const load = async () => {
    try {
      const list = await api.requests();
      setItems(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => {
      clearInterval(timer);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const flash = (tone: 'ok' | 'err', text: string) => {
    setNotice({ tone, text });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  };

  const requester = useRequester(outcome => {
    flash(outcome.kind === 'ok' ? 'ok' : 'err', outcome.message);
    if (outcome.kind === 'ok' && retryOf.current) {
      // The corrected request replaces the failed one.
      void api.removeRequest(retryOf.current).catch(() => {}).finally(() => { retryOf.current = null; void load(); });
    } else {
      void load();
    }
  });

  // Retry a failed request. With no confirmed identity yet, ask which title
  // was meant instead of failing the same way again.
  const retry = async (item: RequestItem) => {
    if (item.selectedProviderId) { await action(item.id, 'approve'); return; }
    setBusyId(item.id);
    try {
      const { candidates } = await lookupRequestCandidates(item.title, item.mediaType);
      if (candidates.length === 0) { flash('err', `No matches found for "${item.title}".`); return; }
      retryOf.current = item.id;
      requester.openPicker({ title: item.title, ...(item.year ? { year: item.year } : {}), mediaType: item.mediaType }, candidates, item.message);
    } catch (err) {
      flash('err', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelected = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const runBulk = async (kind: 'remove' | 'stop' | 'retry') => {
    const targets = items.filter(i => selected.has(i.id));
    setBulkBusy(true);
    setConfirmBulk(null);
    let done = 0;
    let skipped = 0;
    for (const item of targets) {
      try {
        if (kind === 'remove' && !ACTIVE.includes(item.status)) { await api.removeRequest(item.id); done++; }
        else if (kind === 'stop' && ACTIVE.includes(item.status)) { await api.stopRequest(item.id); done++; }
        else if (kind === 'retry' && item.status === 'failed' && item.selectedProviderId) { await api.approveRequest(item.id); done++; }
        else skipped++;
      } catch {
        skipped++;
      }
    }
    setSelected(new Set());
    setBulkBusy(false);
    flash(done > 0 ? 'ok' : 'err', `${done} ${kind === 'remove' ? 'removed' : kind === 'stop' ? 'stopped' : 'retried'}${skipped ? `, ${skipped} skipped (not applicable)` : ''}.`);
    void load();
  };

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const action = async (id: string, kind: 'approve' | 'cancel') => {
    setBusyId(id);
    const target = items.find(item => item.id === id);
    if (kind === 'approve' && target) {
      flash('ok', `Searching ${humanName(target.service).toLowerCase()} for "${target.title}"…`);
    }
    try {
      await (kind === 'approve' ? api.approveRequest(id) : api.cancelRequest(id));
      load();
    } catch (err) {
      flash('err', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const stop = async (id: string) => {
    setBusyId(id);
    try {
      await api.stopRequest(id);
      load();
    } catch (err) {
      flash('err', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await api.removeRequest(id);
      setExpanded(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      load();
    } catch (err) {
      flash('err', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = items.filter(i => ACTIVE.includes(i.status)).length;
  const visible = items.filter(i => inFilter(i, filter));
  const counts: Record<Filter, number> = { all: items.length, active: activeCount, failed: items.filter(i => i.status === 'failed').length, done: items.filter(i => inFilter(i, 'done')).length };
  const selectedItems = items.filter(i => selected.has(i.id));
  const selectMany = (list: RequestItem[]) => setSelected(new Set(list.map(i => i.id)));

  const serviceName = (service: string) => humanName(service);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Requests</h1>
        <div className="page-head-actions">
          {!loading && !error && (
            <span className="page-count">
              {items.length} total{activeCount > 0 ? ` · ${activeCount} active` : ''}
            </span>
          )}
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate('/search')}>
            Request a title
          </button>
        </div>
      </div>

      {notice && <div className={`notice notice--${notice.tone}`}>{notice.text}</div>}

      {loading && <div className="loading-state">Loading requests...</div>}
      {error && <div className="loading-state">Could not load requests: {error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="empty-state">
          No requests yet.
          <span>Request a movie that is missing from your library and it will flow through search, download, and import automatically.</span>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="requests-toolbar">
          <div className="requests-filters" role="tablist" aria-label="Filter requests">
            {(Object.keys(FILTER_LABEL) as Filter[]).map(f => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} className={`season-tab${filter === f ? ' is-active' : ''}`} onClick={() => setFilter(f)}>
                {FILTER_LABEL[f]} ({counts[f]})
              </button>
            ))}
          </div>
          <div className="requests-select-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectMany(visible)} disabled={visible.length === 0}>Select all shown</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectMany(items.filter(i => i.status === 'failed'))} disabled={counts.failed === 0}>Select all failed</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectMany(items.filter(i => inFilter(i, 'done')))} disabled={counts.done === 0}>Select finished</button>
            {selected.size > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>}
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="requests-bulk" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          {confirmBulk === 'remove' ? (
            <>
              <span>Remove {selectedItems.filter(i => !ACTIVE.includes(i.status)).length} finished/failed request(s) from the list?</span>
              <button type="button" className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={() => void runBulk('remove')}>Yes, remove</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmBulk(null)}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={bulkBusy || !selectedItems.some(i => i.status === 'failed' && i.selectedProviderId)} onClick={() => void runBulk('retry')}>Retry</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={bulkBusy || !selectedItems.some(i => ACTIVE.includes(i.status))} onClick={() => void runBulk('stop')}>Stop</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={bulkBusy || !selectedItems.some(i => !ACTIVE.includes(i.status))} onClick={() => setConfirmBulk('remove')}>Remove</button>
            </>
          )}
        </div>
      )}

      {!loading && !error && items.length > 0 && visible.length === 0 && (
        <div className="empty-state">Nothing in this filter.</div>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="requests-grid">
          {visible.map(item => {
            const isOpen = expanded.has(item.id);
            const isActive = ACTIVE.includes(item.status);
            return (
              <article className={`request-card${isOpen ? ' is-open' : ''}${selected.has(item.id) ? ' is-selected' : ''}`} key={item.id}>
                <label className="request-select" title="Select for bulk actions">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} aria-label={`Select ${item.title}`} />
                </label>
                <button type="button" className="request-card-head" onClick={() => toggle(item.id)} aria-expanded={isOpen}>
                  <span className="request-card-toggle" aria-hidden="true"><SvgIcon name={isOpen ? 'chevron-down' : 'chevron-right'} size={16} /></span>
                  <span className="request-card-main">
                    <span className="request-title">{item.title}</span>
                    <span className="request-meta">
                      {item.year ? `${item.year} · ` : ''}via {serviceName(item.service)}
                      {item.requester ? ` · by ${item.requester}` : ''}
                    </span>
                  </span>
                  <StatusPill status={item.status} />
                </button>
                {!isOpen && (item.status === 'downloading' || item.status === 'importing') && (
                  <div className="request-progress request-progress--compact" aria-hidden="true">
                    <div className="request-progress-bar" style={{ width: `${Math.max(3, item.download?.progress ?? item.progress ?? 3)}%` }} />
                  </div>
                )}

                {isOpen && (
                  <div className="request-card-body">
                    {item.overview && <p className="request-overview">{item.overview}</p>}

                    {(item.status === 'downloading' || item.status === 'searching' || item.status === 'importing') && (
                      <div className="request-progress">
                        <div className="request-progress-bar" style={{ width: `${Math.max(3, item.progress ?? 3)}%` }} />
                      </div>
                    )}
                    <RequestActivityFeed events={item.events} status={item.status} />
                    {isAdmin && (item.status === 'searching' || item.status === 'failed') && <ReleasePicker initialQuery={item.title} />}
                    {item.status === 'searching' && (
                      item.message?.startsWith('Nothing found yet')
                        ? <p className="request-detail request-detail--warn">{item.message}</p>
                        : <p className="request-detail">Looking for the best available download. This can take a minute.</p>
                    )}
                    {item.status === 'downloading' && (
                      <p className="request-detail">
                        {item.download
                          ? `Downloading ${item.download.count > 1 ? `${item.download.count} files` : 'release'} · ${item.download.progress}%${item.download.speed ? ` · ${item.download.speed}` : ''}${item.download.eta ? ` · ETA ${item.download.eta}` : ''}${item.download.sourceClient ? ` · ${item.download.sourceClient}` : ''}`
                          : 'A release was found and the download client is receiving it.'}
                      </p>
                    )}
                    {item.status === 'importing' && (
                      <p className="request-detail">Download complete. {serviceName(item.service)} is importing and organizing the files.</p>
                    )}
                    {item.status === 'failed' && item.message && (
                      <p className="request-detail request-detail--error">{item.message}</p>
                    )}
                    {item.status === 'available' && (
                      <p className="request-done">Imported to {serviceName(item.service)}. It now appears in your library.</p>
                    )}

                    {item.qualityProfile && item.rootFolder && (
                      <p className="request-detail">
                        {item.qualityProfile} to {item.rootFolder}
                      </p>
                    )}

                    <div className="request-actions">
                      {(item.status === 'downloading' || item.status === 'importing') && (
                        <Link className="btn btn-secondary btn-sm" to="/downloads">View in Downloads</Link>
                      )}
                      {item.status === 'available' && (item.providerId || item.selectedProviderId) && (
                        <Link
                          className="btn btn-primary btn-sm"
                          to={`${item.mediaType === 'series' ? '/series' : item.mediaType === 'artist' ? '/music' : '/movies'}/${encodeURIComponent(item.providerId ?? item.selectedProviderId ?? '')}`}
                        >
                          Open in library
                        </Link>
                      )}
                      {item.status === 'pending' && (
                        <>
                          {isAdmin ? (
                            <button className="btn btn-primary btn-sm" type="button" onClick={() => action(item.id, 'approve')} disabled={busyId === item.id}>
                              {busyId === item.id ? 'Approving...' : 'Approve'}
                            </button>
                          ) : (
                            <span className="request-detail">Waiting for an administrator to approve this.</span>
                          )}
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => action(item.id, 'cancel')} disabled={busyId === item.id}>
                            {isAdmin ? 'Decline' : 'Cancel request'}
                          </button>
                        </>
                      )}

                      {isActive && (
                        <button className="btn btn-danger btn-sm" type="button" onClick={() => stop(item.id)} disabled={busyId === item.id}>
                          {busyId === item.id ? 'Stopping…' : 'Stop search / download'}
                        </button>
                      )}

                      {item.status === 'failed' && (
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => void retry(item)} disabled={busyId === item.id}>
                          {busyId === item.id ? 'Working…' : item.selectedProviderId ? 'Retry' : 'Choose match & retry'}
                        </button>
                      )}

                      {!isActive && item.status !== 'pending' && (
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => remove(item.id)} disabled={busyId === item.id}>
                          Remove from list
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {requester.picker}
    </main>
  );
}