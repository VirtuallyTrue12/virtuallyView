import { useEffect, useState } from 'react';
import { SvgIcon } from '../ui/SvgIcon';
import {
  deleteSaved, getSaved, keyFor, saveForOffline, type OfflineKind, type SavePhase
} from '../../lib/offline-store';
import './DownloadButton.css';

type Meta = { kind: OfflineKind; id: string; title: string; subtitle?: string; posterUrl?: string; seriesId?: string; durationSeconds?: number | null };

type Phase = 'idle' | 'preparing' | 'saving' | 'saved' | 'error';

interface Props extends Meta {
  /** Renders as a span with role=button, for rows that are already a button (an album's track list). */
  inline?: boolean;
  /** Shorter label for dense rows, such as an episode card. */
  compact?: boolean;
}

/** The label for each state, written for the viewer. */
function labelFor(phase: Phase, percent: number, saved: boolean, askRemove: boolean): string {
  if (askRemove) return 'Remove from this device';
  if (phase === 'preparing') return `Preparing ${percent}%`;
  if (phase === 'saving') return `Saving ${percent}%`;
  if (phase === 'saved' || saved) return 'Saved ✓';
  if (phase === 'error') return 'Try again';
  return 'Download';
}

/** Save an item to this device for offline viewing. A ring fills while the server prepares it and while it is copied. */
export default function DownloadButton(props: Props) {
  const { kind, id, title, subtitle, posterUrl, seriesId, durationSeconds, inline, compact } = props;
  const [saved, setSaved] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [percent, setPercent] = useState(0);
  const [askRemove, setAskRemove] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSaved(keyFor(kind, id)).then(item => { if (!cancelled) setSaved(!!item); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [kind, id]);

  const busy = phase === 'preparing' || phase === 'saving';
  const show = (state: SavePhase) => { setPhase(state.phase); setPercent(state.percent); };

  const activate = async () => {
    if (busy) return;
    if (saved) {
      if (!askRemove) { setAskRemove(true); return; }
      setAskRemove(false);
      await deleteSaved(keyFor(kind, id)).catch(() => undefined);
      setSaved(false);
      setPhase('idle');
      return;
    }
    if (navigator.onLine === false) { setPhase('error'); setMessage('Connect to the server to save this.'); return; }
    setMessage(null);
    setPhase('preparing');
    setPercent(0);
    try {
      await saveForOffline({ kind, id, title, subtitle, posterUrl, seriesId, durationSeconds }, show);
      setSaved(true);
      setPhase('saved');
    } catch (err) {
      setPhase('error');
      setMessage((err as Error).message || 'This could not be saved.');
    }
  };

  const label = labelFor(phase, percent, saved, askRemove);
  const ringPercent = busy ? percent : saved || phase === 'saved' ? 100 : 0;
  const aria = saved ? `${title}: saved on this device. ${askRemove ? 'Remove from this device' : 'Tap again to remove'}` : `Download ${title} to this device`;
  const className = `offline-dl${compact ? ' is-compact' : ''} is-${saved && !busy ? 'saved' : phase}${askRemove ? ' is-asking' : ''}`;
  const content = (
    <>
      <span className="offline-dl-ring" style={{ ['--pct' as string]: ringPercent }} aria-hidden="true">
        {saved && !busy && !askRemove ? <SvgIcon name="check" size={14} /> : askRemove ? <SvgIcon name="trash" size={14} /> : <SvgIcon name="download" size={14} />}
      </span>
      <span className="offline-dl-label">{label}</span>
    </>
  );

  return (
    <span className="offline-dl-wrap">
      {inline ? (
        <span
          role="button"
          tabIndex={0}
          className={className}
          aria-label={aria}
          aria-busy={busy}
          onClick={e => { e.stopPropagation(); void activate(); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); void activate(); } }}
        >{content}</span>
      ) : (
        <button type="button" className={className} aria-label={aria} aria-busy={busy} onClick={() => void activate()}>{content}</button>
      )}
      {message && <span className="offline-dl-message" role="status">{message}</span>}
    </span>
  );
}

interface AlbumTrack { id: string; title: string; hasFile: boolean }

/** "Download album": saves every playable track one after another, so the server converts only one at a time. */
export function DownloadAlbum({ tracks, albumTitle, artist }: { tracks: AlbumTrack[]; albumTitle: string; artist?: string }) {
  const [state, setState] = useState<{ busy: boolean; done: number; total: number; note: string | null }>({ busy: false, done: 0, total: 0, note: null });
  const playable = tracks.filter(t => t.hasFile);

  const run = async () => {
    if (state.busy || playable.length === 0) return;
    setState({ busy: true, done: 0, total: playable.length, note: null });
    let done = 0;
    let failed = 0;
    for (const track of playable) {
      try {
        const already = await getSaved(keyFor('track', track.id));
        if (!already) await saveForOffline({ kind: 'track', id: track.id, title: track.title, subtitle: artist ?? albumTitle }, () => undefined);
      } catch {
        failed++;
      }
      done++;
      setState(s => ({ ...s, done }));
    }
    setState({ busy: false, done, total: playable.length, note: failed ? `${failed} ${failed === 1 ? 'song' : 'songs'} could not be saved.` : 'Album saved to this device.' });
  };

  if (playable.length === 0) return null;
  return (
    <span className="offline-dl-wrap">
      <button type="button" className={`btn btn-secondary offline-album${state.busy ? ' is-busy' : ''}`} onClick={() => void run()} disabled={state.busy} aria-busy={state.busy}>
        <SvgIcon name="download" size={14} />{' '}
        {state.busy ? `Saving ${state.done + 1} of ${state.total}` : 'Download album'}
      </button>
      {state.note && <span className="offline-dl-message" role="status">{state.note}</span>}
    </span>
  );
}
