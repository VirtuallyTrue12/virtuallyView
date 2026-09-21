import { useState } from 'react';
import { api } from '../../lib/api';

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
      >{busy ? 'Scanning…' : 'Scan library'}</button>
      {note && <span className="page-count" role="status">{note}</span>}
    </>
  );
}
