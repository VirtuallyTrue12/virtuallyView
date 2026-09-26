import { Link } from 'react-router-dom';
import type { RequestItem } from '../../lib/api';
import { humanName } from '../../lib/integration-names';
import { Pill, EmptyState } from '../ui/Page';
import { SvgIcon, type IconName } from '../ui/SvgIcon';
import { MenuDivider, MenuItem, MoreMenu } from '../ui/MoreMenu';

export const ACTIVE = ['pending', 'searching', 'downloading', 'importing'];

const STEPS = ['Requested', 'Finding', 'Downloading', 'Filing', 'Ready'];
const stepOf = (status: RequestItem['status']) => ({ pending: 0, searching: 1, downloading: 2, importing: 3, available: 4, failed: -1, cancelled: -1 } as const)[status];
const KIND_ICON: Record<string, IconName> = { movie: 'film', series: 'tv', artist: 'music-note' };
const KIND_WORD: Record<string, string> = { movie: 'Movie', series: 'TV show', artist: 'Music' };
const libraryPath = (item: RequestItem) => `${item.mediaType === 'series' ? '/series' : item.mediaType === 'artist' ? '/music' : '/movies'}/${encodeURIComponent(item.providerId ?? item.selectedProviderId ?? '')}`;

/** "Needs attention": failed, or stuck in a way a person can fix. */
export const needsAttention = (item: RequestItem) =>
  item.status === 'failed' || (ACTIVE.includes(item.status) && /^(Stalled|Nothing found)/.test(item.message ?? ''));

export function statusLine(item: RequestItem, isAdmin: boolean): { tone: 'neutral' | 'ok' | 'warn' | 'bad' | 'info'; text: string } {
  const msg = item.message ?? '';
  switch (item.status) {
    case 'pending': return { tone: 'warn', text: isAdmin ? 'Waiting for your approval.' : 'Waiting for an administrator to approve it.' };
    case 'searching': return msg.startsWith('Nothing found') ? { tone: 'warn', text: msg } : { tone: 'info', text: 'Looking for the best available download. This can take a minute.' };
    case 'downloading': {
      const d = item.download;
      if (msg.startsWith('Stalled')) return { tone: 'warn', text: msg };
      return { tone: 'info', text: d ? `${d.progress}%${d.speed ? ` · ${d.speed}` : ''}${d.eta ? ` · about ${d.eta} left` : ''}${d.count > 1 ? ` · ${d.count} files` : ''}` : 'A release was found and the downloader is receiving it.' };
    }
    case 'importing': return { tone: 'info', text: `Download finished. ${humanName(item.service)} is filing it in your library.` };
    case 'available': return { tone: 'ok', text: msg || 'In your library and ready.' };
    case 'failed': return { tone: 'bad', text: msg || 'This request failed.' };
    default: return { tone: 'neutral', text: 'Cancelled.' };
  }
}

export interface RequestCardProps {
  item: RequestItem;
  poster?: string | undefined;
  isAdmin: boolean;
  busy: boolean;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onDetails: () => void;
  onApprove: () => void;
  onCancel: () => void;
  onStop: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onPickRelease: () => void;
}

export function RequestCard({ item, poster, isAdmin, busy, selecting, selected, onSelect, onDetails, onApprove, onCancel, onStop, onRetry, onRemove, onPickRelease }: RequestCardProps) {
  const step = stepOf(item.status);
  const line = statusLine(item, isAdmin);
  const active = ACTIVE.includes(item.status);
  const pct = Math.round(item.download?.progress ?? item.progress ?? 0);
  const showBar = item.status === 'downloading' || item.status === 'importing';
  const fixable = isAdmin && (item.status === 'searching' || item.status === 'failed' || item.message?.startsWith('Stalled'));

  const primary = (() => {
    if (item.status === 'available' && (item.providerId || item.selectedProviderId)) return <Link className="btn btn-primary" to={libraryPath(item)}><SvgIcon name="play" size={16} /> Open</Link>;
    if (item.status === 'failed') return <button type="button" className="btn btn-primary" onClick={onRetry} disabled={busy}><SvgIcon name="refresh" size={16} /> {busy ? 'Working…' : item.selectedProviderId ? 'Retry' : 'Choose match'}</button>;
    if (item.status === 'pending' && isAdmin) return <button type="button" className="btn btn-primary" onClick={onApprove} disabled={busy}><SvgIcon name="check" size={16} /> {busy ? 'Approving…' : 'Approve'}</button>;
    if (item.status === 'downloading' || item.status === 'importing') return <Link className="btn btn-secondary" to="/downloads"><SvgIcon name="download" size={16} /> Download</Link>;
    return null;
  })();

  return (
    <article className={`rq${selected ? ' is-selected' : ''} rq--${item.status}`} aria-label={item.title}>
      {selecting && (
        <label className="rq-select"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${item.title}`} /></label>
      )}
      <div className="rq-poster" aria-hidden="true">
        {poster ? <img src={poster} alt="" loading="lazy" /> : <SvgIcon name={KIND_ICON[item.mediaType] ?? 'film'} size={26} />}
      </div>
      <div className="rq-main">
        <div className="rq-title-row">
          <h3 className="rq-title">{item.title}{item.year ? <span className="rq-year"> {item.year}</span> : null}</h3>
          <Pill tone={line.tone === 'info' ? 'info' : line.tone}>{item.status === 'available' ? 'Ready' : item.status === 'failed' ? 'Failed' : item.status === 'cancelled' ? 'Cancelled' : item.status === 'pending' ? 'Waiting' : item.status === 'searching' ? 'Finding' : item.status === 'downloading' ? 'Downloading' : 'Filing'}</Pill>
        </div>
        <p className="rq-meta">{KIND_WORD[item.mediaType] ?? item.mediaType}{item.requester ? ` · requested by ${item.requester}` : ''}{item.qualityProfile ? ` · ${item.qualityProfile}` : ''}</p>

        {step >= 0 && item.status !== 'cancelled' && (
          <ol className="rq-steps" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
            {STEPS.map((label, i) => <li key={label} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}><span>{label}</span></li>)}
          </ol>
        )}
        {showBar && <div className="rq-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${Math.max(3, pct)}%` }} /></div>}
        <p className={`rq-line rq-line--${line.tone}`}>{line.text}</p>
      </div>
      <div className="rq-actions">
        {primary}
        <MoreMenu label={`More for ${item.title}`}>
          <MenuItem icon="list" label="Activity and details" onSelect={onDetails} />
          {fixable && <MenuItem icon="search" label="Pick a release by hand" hint="Choose exactly which download" onSelect={onPickRelease} />}
          {item.status === 'pending' && <MenuItem icon="close" label={isAdmin ? 'Decline' : 'Cancel request'} onSelect={onCancel} />}
          {active && item.status !== 'pending' && <MenuItem icon="stop" label="Stop search and download" onSelect={onStop} />}
          {!active && <><MenuDivider /><MenuItem icon="trash" label="Remove from list" danger onSelect={onRemove} /></>}
        </MoreMenu>
      </div>
    </article>
  );
}

export function RequestsEmpty({ onRequest }: { onRequest: () => void }) {
  return <EmptyState icon="plus" title="No requests yet" text="Ask for a movie, show or artist and it is searched, downloaded and filed for you. You can follow every step here." action={<button type="button" className="btn btn-primary" onClick={onRequest}><SvgIcon name="search" size={16} /> Find something</button>} />;
}
