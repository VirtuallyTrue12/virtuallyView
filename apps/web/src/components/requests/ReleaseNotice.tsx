import { useEffect } from 'react';
import { SvgIcon } from '../ui/SvgIcon';

/** A film that is still in cinemas: only camera copies exist, so let the person choose. */
export function ReleaseNotice({ title, message, busy, onChoose, onClose }: {
  title: string;
  message: string;
  busy: boolean;
  onChoose: (choice: 'wait' | 'now') => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="picker-backdrop" role="dialog" aria-modal="true" aria-label={`${title} is still in cinemas`} onClick={onClose}>
      <div className="picker release-notice" onClick={e => e.stopPropagation()}>
        <div className="picker-head">
          <div>
            <h2 className="picker-title">"{title}" is still in cinemas</h2>
            <p className="picker-hint">{message}</p>
          </div>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close"><SvgIcon name="close" size={16} /></button>
        </div>
        <div className="release-notice-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onChoose('wait')}>
            {busy ? 'Working...' : 'Wait for a proper release'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onChoose('now')}>
            Search now anyway
          </button>
        </div>
      </div>
    </div>
  );
}
