import { useEffect } from 'react';
import type { RequestCandidate } from '../../lib/request-selection';
import { QualitySelect } from './QualitySelect';
import { SvgIcon } from '../ui/SvgIcon';

const KIND: Record<string, string> = { movie: 'Movie', series: 'TV show', artist: 'Artist' };

export function CandidatePicker({ title, message, candidates, busy, onPick, onClose }: {
  title: string;
  message?: string;
  candidates: RequestCandidate[];
  busy: boolean;
  onPick: (candidate: RequestCandidate) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="picker-backdrop" role="dialog" aria-modal="true" aria-label={`Choose the right match for ${title}`} onClick={onClose}>
      <div className="picker" onClick={e => e.stopPropagation()}>
        <div className="picker-head">
          <div>
            <h2 className="picker-title">Which "{title}"?</h2>
            <p className="picker-hint">{message ?? 'Several matches were found. Pick the exact one to request.'}</p>
          </div>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Close"><SvgIcon name="close" size={16} /></button>
        </div>
        <div className="picker-list">
          {candidates.slice(0, 12).map((c, i) => (
            <div className="picker-item" key={`${c.provider}-${c.providerId}`}>
              <div className="picker-poster">
                {c.poster ? <img src={c.poster} alt="" loading="lazy" /> : <SvgIcon name={c.type === 'artist' ? 'mic' : c.type === 'series' ? 'tv' : 'film'} size={26} />}
              </div>
              <div className="picker-body">
                <div className="picker-line">
                  <strong>{c.title}</strong>
                  {c.year ? <span className="picker-year">{c.year}</span> : null}
                  {i === 0 && candidates.length > 1 && c.popularity ? <span className="picker-badge">Most popular</span> : null}
                </div>
                <span className="picker-meta">{KIND[c.type] ?? c.type} · {c.provider.toUpperCase()} #{c.providerId.slice(0, 8)}</span>
                {c.overview && <p className="picker-overview">{c.overview}</p>}
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onPick(c)}>
                {busy ? '…' : 'Request'}
              </button>
            </div>
          ))}
        </div>
        {candidates[0] && (
          <div className="picker-foot">
            <span className="picker-hint">Quality is used for the title you pick.</span>
            <QualitySelect mediaType={candidates[0].type as 'movie' | 'series' | 'artist'} />
          </div>
        )}
      </div>
    </div>
  );
}
