import { QUALITY_ORDER, estimateBytes, lastQuality, qualityLabel, type OfflineQuality } from '../../lib/offline-plan';
import { formatBytes } from '../../lib/offline-store';

/** Smaller / Standard / High, each with a size guess for `seconds` of video. The last choice is marked. */
export default function QualityPicker({ seconds, onPick }: { seconds: number | null; onPick: (q: OfflineQuality) => void }) {
  const last = lastQuality();
  return (
    <div className="offline-quality" role="group" aria-label="Choose quality">
      {QUALITY_ORDER.map(q => (
        <button key={q} type="button" className={`btn ${q === last ? 'btn-primary' : 'btn-secondary'}`} aria-current={q === last} onClick={() => onPick(q)}>
          {qualityLabel(q, estimateBytes(seconds, q), formatBytes)}
        </button>
      ))}
    </div>
  );
}
