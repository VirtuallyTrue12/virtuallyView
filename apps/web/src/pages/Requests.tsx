import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RequestActivityFeed } from '../components/requests/RequestActivityFeed';
import { ACTIVE, RequestCard, RequestsEmpty, needsAttention } from '../components/requests/RequestCard';
import { EmptyState, PageHeader, Seg, SubNav } from '../components/ui/Page';
import { Dialog } from '../components/ui/Dialog';
import { api, type RequestItem } from '../lib/api';
import { lookupRequestCandidates } from '../lib/request-selection';
import { useRequester } from '../lib/useRequester';
import { humanName } from '../lib/integration-names';
import { SvgIcon } from '../components/ui/SvgIcon';
import { ReleasePicker } from '../components/media/ReleasePicker';

type Filter = 'all' | 'active' | 'attention' | 'done';
const inFilter = (item: RequestItem, f: Filter) =>
  f === 'all' || (f === 'active' && ACTIVE.includes(item.status)) || (f === 'attention' && needsAttention(item)) ||
  (f === 'done' && (item.status === 'available' || item.status === 'cancelled'));

export default function Requests() {
  const navigate = useNavigate();
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmBulk, setConfirmBulk] = useState<'remove' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [detail, setDetail] = useState<RequestItem | null>(null);
  const [picking, setPicking] = useState<RequestItem | null>(null);
  const [art, setArt] = useState<Map<string, string>>(new Map());
  useEffect(() => { api.authStatus().then(st => setIsAdmin(st.user?.role === 'admin')).catch(() => {}); }, []);
  const retryOf = useRef<string | null>(null);

  // Older requests carry no artwork of their own; borrow it from the library when the title is in it.
  useEffect(() => {
    let live = true;
    Promise.allSettled([api.movies(), api.series(), api.artists()]).then(([m, t, a]) => {
      if (!live) return;
      const map = new Map<string, string>();
      const add = (kind: string, list: PromiseSettledResult<{ title: string; artwork?: { poster?: string } }[]>) => {
        if (list.status === 'fulfilled') for (const i of list.value) if (i.artwork?.poster) map.set(`${kind}:${i.title.toLowerCase()}`, i.artwork.poster);
      };
      add('movie', m); add('series', t); add('artist', a);
      setArt(map);
    });
    return () => { live = false; };
  }, []);

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
      load();
    } catch (err) {
      flash('err', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = items.filter(i => ACTIVE.includes(i.status)).length;
  const attentionCount = items.filter(needsAttention).length;
  const visible = items.filter(i => inFilter(i, filter));
  const counts: Record<Filter, number> = { all: items.length, active: activeCount, attention: attentionCount, done: items.filter(i => inFilter(i, 'done')).length };
  const selectedItems = items.filter(i => selected.has(i.id));
  const selectMany = (list: RequestItem[]) => setSelected(new Set(list.map(i => i.id)));
  const posterOf = (item: RequestItem) => item.poster ?? art.get(`${item.mediaType}:${item.title.toLowerCase()}`);
  const endSelecting = () => { setSelecting(false); setSelected(new Set()); setConfirmBulk(null); };

  return (
    <main className="page">
      <PageHeader
        title="Requests"
        sub={loading || error ? undefined : items.length === 0 ? 'Nothing requested yet' : `${activeCount} in progress${attentionCount ? ` · ${attentionCount} need attention` : ''} · ${items.length} in all`}
        actions={<>
          <button className="btn btn-primary" type="button" onClick={() => navigate('/search')}><SvgIcon name="plus" size={17} /> Request a title</button>
          {items.length > 1 && <button className="btn btn-secondary" type="button" onClick={() => (selecting ? endSelecting() : setSelecting(true))} aria-pressed={selecting}><SvgIcon name={selecting ? 'close' : 'check'} size={17} /> {selecting ? 'Done' : 'Select'}</button>}
        </>}
      />
      <SubNav label="Requests and downloads" items={[{ to: '/search', label: 'Find', icon: 'search' }, { to: '/requests', label: 'Requests', icon: 'list', badge: activeCount }, { to: '/downloads', label: 'Downloads', icon: 'download' }]} />

      {notice && <div className={`notice notice--${notice.tone}`} role="status">{notice.text}</div>}
      {loading && <div className="loading-state">Loading requests...</div>}
      {error && <div className="loading-state">Could not load requests: {error}</div>}
      {!loading && !error && items.length === 0 && <RequestsEmpty onRequest={() => navigate('/search')} />}

      {!loading && !error && items.length > 0 && (
        <div className="rq-toolbar">
          <Seg<Filter> label="Show requests" value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'All', count: counts.all }, { value: 'active', label: 'In progress', count: counts.active },
            { value: 'attention', label: 'Needs attention', count: counts.attention }, { value: 'done', label: 'Finished', count: counts.done }
          ]} />
          {selecting && (
            <div className="rq-select-tools">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectMany(visible)} disabled={visible.length === 0}>All shown</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectMany(items.filter(needsAttention))} disabled={counts.attention === 0}>All needing attention</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => selectMany(items.filter(i => inFilter(i, 'done')))} disabled={counts.done === 0}>All finished</button>
            </div>
          )}
        </div>
      )}

      {!loading && !error && items.length > 0 && visible.length === 0 && (
        <EmptyState icon="check" title={filter === 'attention' ? 'Nothing needs attention' : 'Nothing here'} text={filter === 'attention' ? 'Every request is either moving along or finished.' : 'No requests match this view.'} />
      )}

      {visible.length > 0 && (
        <div className="rq-list">
          {visible.map(item => (
            <RequestCard
              key={item.id} item={item} poster={posterOf(item)} isAdmin={isAdmin} busy={busyId === item.id}
              selecting={selecting} selected={selected.has(item.id)} onSelect={() => toggleSelected(item.id)}
              onDetails={() => setDetail(item)} onApprove={() => void action(item.id, 'approve')} onCancel={() => void action(item.id, 'cancel')}
              onStop={() => void stop(item.id)} onRetry={() => void retry(item)} onRemove={() => void remove(item.id)} onPickRelease={() => setPicking(item)}
            />
          ))}
        </div>
      )}

      {selecting && selected.size > 0 && (
        <div className="rq-bulk" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          {confirmBulk === 'remove' ? (
            <>
              <span>Remove {selectedItems.filter(i => !ACTIVE.includes(i.status)).length} finished or failed?</span>
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

      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? 'Request'} wide>
        {detail && (
          <div className="rq-detail">
            {detail.overview && <p className="rq-overview">{detail.overview}</p>}
            <dl className="detail-facts">
              <div><dt>Status</dt><dd>{detail.status}</dd></div>
              <div><dt>Handled by</dt><dd>{humanName(detail.service)}</dd></div>
              {detail.qualityProfile && <div><dt>Quality</dt><dd>{detail.qualityProfile}</dd></div>}
              {detail.rootFolder && <div><dt>Saved to</dt><dd>{detail.rootFolder}</dd></div>}
              {detail.requester && <div><dt>Requested by</dt><dd>{detail.requester}</dd></div>}
              <div><dt>Requested</dt><dd>{new Date(detail.createdAt).toLocaleString()}</dd></div>
            </dl>
            <h3 className="ui-section-title">What happened</h3>
            <RequestActivityFeed events={detail.events} status={detail.status} />
          </div>
        )}
      </Dialog>

      <Dialog open={!!picking} onClose={() => setPicking(null)} title={`Pick a release: ${picking?.title ?? ''}`} wide>
        {picking && <ReleasePicker initialQuery={picking.title} />}
      </Dialog>
      {requester.picker}
    </main>
  );
}
