import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

const CONFIG = {
  artist: { label: 'artist', back: '/music', remove: (id: string, files: boolean) => api.deleteArtist(id, files) },
  series: { label: 'TV show', back: '/series', remove: (id: string, files: boolean) => api.deleteSeries(id, files) }
} as const;

/** Two-step remove from the library, with the choice to keep or delete the files. */
export function RemoveTitle({ kind, id, title }: { kind: keyof typeof CONFIG; id: string; title: string }) {
  const navigate = useNavigate();
  const cfg = CONFIG[kind];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const run = async (deleteFiles: boolean) => {
    setBusy(true);
    setNote({ tone: 'ok', text: `Removing ${title}…` });
    try {
      await cfg.remove(id, deleteFiles);
      setNote({ tone: 'ok', text: `${title} was removed from your library.` });
      window.setTimeout(() => navigate(cfg.back), 900);
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn btn-secondary" type="button" onClick={() => setConfirming(v => !v)} aria-expanded={confirming} disabled={busy}>
        Remove {cfg.label}
      </button>
      {confirming && (
        <span className="detail-delete-confirm">
          <span>Remove {title} from your library?</span>
          <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={() => void run(false)}>Remove, keep files</button>
          <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={() => void run(true)}>Remove and delete files</button>
          <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </span>
      )}
      {note && <div className={`notice notice--${note.tone}`} style={{ width: '100%' }}>{note.text}</div>}
    </>
  );
}
