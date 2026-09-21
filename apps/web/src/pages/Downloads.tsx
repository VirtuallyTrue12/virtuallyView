import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchAgain } from '../components/media/SearchAgain';
import { Link } from 'react-router-dom';
import { StatusPill } from '../components/media/StatusPill';
import { api, type DownloadItem } from '../lib/api';
import { BackButton } from '../components/layout/BackButton';

type ConfirmTarget = { id: string; title: string; mode: 'remove' | 'delete-files' } | null;

export default function Downloads() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [confirm, setConfirm] = useState<ConfirmTarget>(null);

  const refresh = useCallback((list?: DownloadItem[]) => {
    if (list) {
      setItems(list);
      return;
    }
    api.downloads()
      .then(setItems)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = useCallback(
    async (id: string, action: 'pause' | 'resume' | 'remove' | 'delete-files') => {
      setBusyId(id);
      setError(null);
      try {
        if (action === 'remove' || action === 'delete-files') {
          const result = action === 'remove' ? await api.removeDownload(id) : await api.deleteDownloadFiles(id);
          if (!result.success) {
            const message = (result as { message?: string }).message;
            throw new Error(message || 'The download client rejected the action.');
          }
          setItems(prev => prev.filter(d => d.id !== id));
        } else {
          const result = action === 'pause' ? await api.pauseDownload(id) : await api.resumeDownload(id);
          if (!result.success) throw new Error(result.message);
          setItems(await api.downloads());
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyId(null);
        setConfirm(null);
      }
    },
    []
  );

  const matchesFilter = useCallback(
    (d: DownloadItem) => {
      const q = filter.trim().toLowerCase();
      if (!q) return true;
      return d.title.toLowerCase().includes(q) || (d.mediaType ?? '').includes(q) || (d.sourceClient ?? '').includes(q);
    },
    [filter]
  );

  const active = useMemo(() => items.filter(d => !['completed', 'failed'].includes(d.status)), [items]);
  const finished = useMemo(() => items.filter(d => ['completed', 'failed'].includes(d.status)), [items]);
  const finishedFiltered = useMemo(() => finished.filter(matchesFilter), [finished, matchesFilter]);

  return (
    <main className="page">

      <BackButton to="/" label="Home" />
      <div className="page-head">
        <h1>Downloads</h1>
        <span className="page-count">{items.length} total</span>
      </div>

      {error && <div className="loading-state">Download action failed: {error}</div>}
      {loading && <div className="loading-state">Loading downloads...</div>}
      {!loading && items.length === 0 && (
        <div className="loading-state">No downloads right now.</div>
      )}

      {!loading && active.length > 0 && (
        <>
          <h2 className="section-title">Active</h2>
          <div className="download-list">
            {active.map(d => (
              <DownloadRow
                key={d.id}
                item={d}
                busy={busyId === d.id}
                onPause={() => act(d.id, 'pause')}
                onResume={() => act(d.id, 'resume')}
                onRemove={() => act(d.id, 'remove')}
                onDeleteFiles={() => setConfirm({ id: d.id, title: d.title, mode: 'delete-files' })}
              />
            ))}
          </div>
        </>
      )}

      {!loading && finished.length > 0 && (
        <>
          <div className="downloads-head">
            <h2 className="section-title">Completed</h2>
            <input
              className="search-field"
              type="search"
              placeholder="Search completed downloads"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              aria-label="Search completed downloads"
            />
          </div>
          <div className="download-list">
            {finishedFiltered.length === 0 ? (
              <div className="empty-state">
                {filter.trim() ? `No completed downloads match "${filter}".` : 'No completed downloads yet.'}
              </div>
            ) : (
              finishedFiltered.map(d => (
                <DownloadRow
                  key={d.id}
                  item={d}
                  busy={busyId === d.id}
                  onPause={() => act(d.id, 'pause')}
                  onResume={() => act(d.id, 'resume')}
                  onRemove={() => act(d.id, 'remove')}
                  onDeleteFiles={() => setConfirm({ id: d.id, title: d.title, mode: 'delete-files' })}
                />
              ))
            )}
          </div>
        </>
      )}

      {confirm && (
        <div className="download-confirm" role="dialog" aria-modal="true" aria-label="Delete download">
          <div className="download-confirm-card">
            <h3>{confirm.mode === 'delete-files' ? 'Delete download and its files?' : 'Remove this download?'}</h3>
            <p>
              {confirm.mode === 'delete-files'
                ? `"${confirm.title}" will be removed from the download client and its files deleted from disk. This cannot be undone.`
                : `"${confirm.title}" will be removed from the download list. Its files are left untouched.`}
            </p>
            <div className="download-confirm-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setConfirm(null)} disabled={busyId === confirm.id}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => void act(confirm.id, confirm.mode)}
                disabled={busyId === confirm.id}
              >
                {busyId === confirm.id ? 'Working…' : confirm.mode === 'delete-files' ? 'Delete and remove files' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

type RowProps = {
  item: DownloadItem;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
  onDeleteFiles: () => void;
};

function DownloadRow({ item, busy, onPause, onResume, onRemove, onDeleteFiles }: RowProps) {
  const allowed = item.actions ?? ['pause', 'resume', 'remove'];
  const showPause = allowed.includes('pause') && item.status === 'downloading';
  const showResume = allowed.includes('resume') && item.status === 'paused';
  const showRemove = allowed.includes('remove');
  const showDeleteFiles = allowed.includes('delete-files') && ['completed', 'failed', 'paused'].includes(item.status);
  const details = [item.size, item.savePath, item.speed, item.eta ? `ETA ${item.eta}` : null].filter(Boolean) as string[];

  return (
    <div className="download-row">
      <div className="download-art" aria-hidden="true">
        {item.artwork?.poster ? (
          <img src={item.artwork.poster} alt="" className="download-art-img" />
        ) : (
          <StatusPill status={item.status} />
        )}
      </div>
      <div className="download-main">
        <div className="download-title-line">
          <h3 className="download-title" title={item.rawTitle && item.rawTitle !== item.title ? item.rawTitle : undefined}>{item.title}</h3>
          {item.qualityLabel && <span className="download-source">{item.qualityLabel}</span>}
          {item.year && <span className="download-year">{item.year}</span>}
          {item.requestId && <Link className="download-source" to="/requests" title="Show the request that started this download">Requested</Link>}
          {item.sourceClient && <span className="download-source">{item.reportedBy?.join(' + ') || item.sourceClient}</span>}
        </div>
        {item.message && <p className="download-message">{item.message}</p>}
        <div className="download-progress" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${item.progress}%` }} />
        </div>
        <div className="download-details">
          <span>{item.progress}%</span>
          {details.map(detail => <span key={detail}>{detail}</span>)}
        </div>
      </div>
      <div className="download-actions">
        {item.mediaId && item.status === 'completed' && (
          <Link
            className={`btn btn-primary btn-sm${item.mediaType === 'series' ? ' btn--series' : ''}`}
            to={`${item.mediaType === 'series' ? '/series' : item.mediaType === 'artist' ? '/music' : '/movies'}/${encodeURIComponent(item.mediaId)}`}
          >
            View in library
          </Link>
        )}
        {item.status === 'failed' && <SearchAgain label="Retry" run={() => api.retryDownload(item.id)} />}
        {showRemove && <button className="btn btn-secondary btn-sm" type="button" onClick={onRemove} disabled={busy}>
          Remove
        </button>}
        {showDeleteFiles && <button className="btn btn-danger btn-sm" type="button" onClick={onDeleteFiles} disabled={busy}>
          Delete files
        </button>}
        {showPause && (
          <button className="btn btn-secondary btn-sm" type="button" onClick={onPause} disabled={busy}>
            Pause
          </button>
        )}
        {showResume && (
          <button className="btn btn-secondary btn-sm" type="button" onClick={onResume} disabled={busy}>
            Resume
          </button>
        )}
      </div>
    </div>
  );
}