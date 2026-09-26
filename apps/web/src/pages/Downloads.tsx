import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchAgain } from '../components/media/SearchAgain';
import { Link } from 'react-router-dom';
import { api, type DownloadItem } from '../lib/api';
import { EmptyState, PageHeader, Pill, Seg, StatTile, SubNav } from '../components/ui/Page';
import { Dialog } from '../components/ui/Dialog';
import { MenuDivider, MenuItem, MoreMenu } from '../components/ui/MoreMenu';
import { SvgIcon, type IconName } from '../components/ui/SvgIcon';

type View = 'active' | 'attention' | 'done' | 'all';
const isDone = (d: DownloadItem) => d.status === 'completed';
const isBad = (d: DownloadItem) => d.status === 'failed' || d.status === 'stalled';
const isLive = (d: DownloadItem) => !isDone(d) && !isBad(d);
const UNITS: Record<string, number> = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1048576, GB: 1e9, GIB: 1073741824 };
/** "3.2 MB/s" to bytes per second; anything unreadable counts as nothing. */
const bytesPerSecond = (speed?: string) => {
  const m = /^([\d.]+)\s*([KMG]?i?B)/i.exec(speed ?? '');
  return m ? Number(m[1]) * (UNITS[m[2]!.toUpperCase()] ?? 0) : 0;
};
const rate = (bps: number) => bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} MB/s` : bps >= 1e3 ? `${Math.round(bps / 1e3)} KB/s` : '0 KB/s';
const KIND_ICON: Record<string, IconName> = { movie: 'film', series: 'tv', artist: 'music-note' };

type ConfirmTarget = { id: string; title: string; mode: 'remove' | 'delete-files' } | null;

export default function Downloads() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
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

  const live = useMemo(() => items.filter(isLive), [items]);
  const attention = useMemo(() => items.filter(isBad), [items]);
  const finished = useMemo(() => items.filter(isDone), [items]);
  const running = live.filter(d => d.status === 'downloading');
  const paused = live.filter(d => d.status === 'paused');
  const totalRate = running.reduce((sum, d) => sum + bytesPerSecond(d.speed), 0);
  // Open on what matters: what is moving, else what is broken, else what finished.
  const current: View = view ?? (live.length ? 'active' : attention.length ? 'attention' : finished.length ? 'done' : 'all');
  const shown = (current === 'active' ? live : current === 'attention' ? attention : current === 'done' ? finished : items).filter(matchesFilter);

  const setAll = async (action: 'pause' | 'resume') => {
    setBulkBusy(true);
    const targets = action === 'pause' ? running : paused;
    await Promise.allSettled(targets.map(d => (action === 'pause' ? api.pauseDownload(d.id) : api.resumeDownload(d.id))));
    setItems(await api.downloads().catch(() => items));
    setBulkBusy(false);
  };

  const rowProps = (d: DownloadItem) => ({
    item: d, busy: busyId === d.id,
    onPause: () => act(d.id, 'pause'), onResume: () => act(d.id, 'resume'), onRemove: () => act(d.id, 'remove'),
    onDeleteFiles: () => setConfirm({ id: d.id, title: d.title, mode: 'delete-files' as const })
  });

  return (
    <main className="page">
      <PageHeader
        title="Downloads"
        sub={loading ? undefined : items.length === 0 ? 'Nothing downloading' : `${running.length} downloading${running.length ? ` at ${rate(totalRate)}` : ''}${paused.length ? ` · ${paused.length} paused` : ''}${attention.length ? ` · ${attention.length} need attention` : ''}`}
        actions={<>
          {running.length > 0 && <button className="btn btn-secondary" type="button" disabled={bulkBusy} onClick={() => void setAll('pause')}><SvgIcon name="pause" size={17} /> Pause all</button>}
          {paused.length > 0 && <button className="btn btn-primary" type="button" disabled={bulkBusy} onClick={() => void setAll('resume')}><SvgIcon name="play" size={17} /> Resume all</button>}
        </>}
      />
      <SubNav label="Requests and downloads" items={[{ to: '/search', label: 'Find', icon: 'search' }, { to: '/requests', label: 'Requests', icon: 'list' }, { to: '/downloads', label: 'Downloads', icon: 'download', badge: live.length }]} />

      {error && <div className="notice notice--err" role="alert">Download action failed: {error}</div>}
      {loading && <div className="loading-state">Loading downloads...</div>}
      {!loading && items.length === 0 && <EmptyState icon="download" title="No downloads right now" text="When you request something it appears here while it downloads, then moves to Completed once it is in your library." action={<Link to="/search" className="btn btn-primary"><SvgIcon name="search" size={16} /> Find something</Link>} />}

      {!loading && items.length > 0 && (
        <>
          <div className="ui-stats">
            <StatTile label="Downloading" value={running.length} hint={running.length ? rate(totalRate) : 'idle'} />
            <StatTile label="Paused or queued" value={paused.length + live.filter(d => d.status !== 'downloading' && d.status !== 'paused').length} />
            <StatTile label="Need attention" value={attention.length} tone={attention.length ? 'warn' : undefined} hint={attention.length ? 'failed or stalled' : 'all clear'} />
            <StatTile label="Completed" value={finished.length} />
          </div>
          <div className="rq-toolbar">
            <Seg<View> label="Show downloads" value={current} onChange={setView} options={[
              { value: 'active', label: 'In progress', count: live.length }, { value: 'attention', label: 'Needs attention', count: attention.length },
              { value: 'done', label: 'Completed', count: finished.length }, { value: 'all', label: 'All', count: items.length }
            ]} />
            {(current === 'done' || current === 'all') && items.length > 6 && (
              <input className="settings-input dl-search" type="search" placeholder="Search downloads" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Search downloads" />
            )}
          </div>
          {shown.length === 0 ? (
            <EmptyState icon="check" title={current === 'attention' ? 'Nothing needs attention' : 'Nothing here'} text={filter.trim() ? `No downloads match "${filter}".` : current === 'active' ? 'Nothing is downloading right now.' : undefined} />
          ) : (
            <div className="dl-list">{shown.map(d => <DownloadRow key={d.id} {...rowProps(d)} />)}</div>
          )}
        </>
      )}

      <Dialog open={!!confirm} onClose={() => !confirm || busyId !== confirm.id ? setConfirm(null) : undefined} title={confirm?.mode === 'delete-files' ? 'Delete download and its files?' : 'Remove this download?'}>
        {confirm && (
          <>
            <p className="dlg-help">
              {confirm.mode === 'delete-files'
                ? `"${confirm.title}" will be removed from the downloader and its files deleted from disk. This cannot be undone.`
                : `"${confirm.title}" will be removed from the download list. Its files are left untouched.`}
            </p>
            <div className="dlg-actions">
              <button className="btn btn-danger" type="button" onClick={() => void act(confirm.id, confirm.mode)} disabled={busyId === confirm.id}>{busyId === confirm.id ? 'Working…' : confirm.mode === 'delete-files' ? 'Delete and remove files' : 'Remove'}</button>
              <button className="btn btn-secondary" type="button" onClick={() => setConfirm(null)} disabled={busyId === confirm.id}>Cancel</button>
            </div>
          </>
        )}
      </Dialog>
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

const STATE_PILL: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; label: string }> = {
  downloading: { tone: 'info', label: 'Downloading' }, paused: { tone: 'neutral', label: 'Paused' }, queued: { tone: 'neutral', label: 'Queued' },
  completed: { tone: 'ok', label: 'Completed' }, failed: { tone: 'bad', label: 'Failed' }, stalled: { tone: 'warn', label: 'Stalled' }, importing: { tone: 'info', label: 'Filing' }
};

function DownloadRow({ item, busy, onPause, onResume, onRemove, onDeleteFiles }: RowProps) {
  const allowed = item.actions ?? ['pause', 'resume', 'remove'];
  const showPause = allowed.includes('pause') && item.status === 'downloading';
  const showResume = allowed.includes('resume') && item.status === 'paused';
  const showRemove = allowed.includes('remove');
  const showDeleteFiles = allowed.includes('delete-files') && ['completed', 'failed', 'paused', 'stalled'].includes(item.status);
  const details = [item.size, item.speed, item.eta ? `${item.eta} left` : null].filter(Boolean) as string[];
  const pill = STATE_PILL[item.status] ?? { tone: 'neutral' as const, label: item.status };
  const libraryTo = item.mediaId && item.status === 'completed' ? `${item.mediaType === 'series' ? '/series' : item.mediaType === 'artist' ? '/music' : '/movies'}/${encodeURIComponent(item.mediaId)}` : null;

  return (
    <article className={`dl dl--${item.status}`} aria-label={item.title}>
      <div className="rq-poster dl-art" aria-hidden="true">
        {item.artwork?.poster ? <img src={item.artwork.poster} alt="" loading="lazy" /> : <SvgIcon name={KIND_ICON[item.mediaType ?? ''] ?? 'download'} size={24} />}
      </div>
      <div className="dl-main">
        <div className="rq-title-row">
          <h3 className="rq-title" title={item.rawTitle && item.rawTitle !== item.title ? item.rawTitle : undefined}>{item.title}{item.year ? <span className="rq-year"> {item.year}</span> : null}</h3>
          <Pill tone={pill.tone}>{pill.label}</Pill>
          {item.qualityLabel && <span className="dl-tag">{item.qualityLabel}</span>}
        </div>
        <div className="rq-bar" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.max(item.progress > 0 ? 2 : 0, item.progress)}%` }} /></div>
        <p className="dl-line"><strong>{item.progress}%</strong>{details.map(detail => <span key={detail}>{detail}</span>)}{item.requestId && <Link to="/requests">Requested</Link>}</p>
        {item.message && <p className={`rq-line rq-line--${isBad(item) ? 'warn' : 'neutral'}`}>{item.message}</p>}
      </div>
      <div className="rq-actions">
        {libraryTo && <Link className="btn btn-primary" to={libraryTo}><SvgIcon name="play" size={16} /> Open</Link>}
        {(item.status === 'failed' || item.status === 'stalled') && <SearchAgain label={item.status === 'stalled' ? 'Try another release' : 'Retry'} run={() => api.retryDownload(item.id)} small={false} />}
        {showPause && <button className="btn btn-secondary" type="button" onClick={onPause} disabled={busy}><SvgIcon name="pause" size={16} /> Pause</button>}
        {showResume && <button className="btn btn-secondary" type="button" onClick={onResume} disabled={busy}><SvgIcon name="play" size={16} /> Resume</button>}
        {(showRemove || showDeleteFiles) && (
          <MoreMenu label={`More for ${item.title}`}>
            {showRemove && <MenuItem icon="close" label="Remove from list" hint="Keeps the files" onSelect={onRemove} />}
            {showDeleteFiles && <><MenuDivider /><MenuItem icon="trash" label="Delete files too" danger onSelect={onDeleteFiles} /></>}
          </MoreMenu>
        )}
      </div>
    </article>
  );
}
