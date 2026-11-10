import { useState } from 'react';
import { api } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

/** Ask the media manager to rescan disk for new files. */
export function ScanButton({ type }: { type: 'movie' | 'series' | 'artist' }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn btn-secondary btn-sm"
        type="button"
        disabled={busy}
        title="Look for new or changed files and refresh metadata"
        onClick={async () => {
          setBusy(true);
          setNote(null);
          try {
            const { results } = await api.scanLibrary([type]);
            setNote(results.map(r => r.message).join(' '));
          } catch (err) {
            setNote((err as Error).message);
          } finally {
            setBusy(false);
            setTimeout(() => setNote(null), 6000);
          }
        }}
        aria-label={busy ? 'Scanning library' : 'Scan library'}
      ><SvgIcon name="refresh" size={15} /> <span className="btn-label">{busy ? 'Scanning…' : 'Scan library'}</span></button>
      {note && <span className="page-count" role="status">{note}</span>}
    </>
  );
}
