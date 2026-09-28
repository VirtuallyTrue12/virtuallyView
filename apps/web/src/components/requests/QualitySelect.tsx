import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Kind = 'movie' | 'series' | 'artist';
const cache = new Map<Kind, { profiles: string[]; defaultName: string }>();

/**
 * Dropdown of the quality profiles the media service really has (e.g. HD-1080p, Ultra-HD, Lossless).
 * Fully controlled by the caller and never persisted: a choice made for one request must never silently
 * carry over as the default for the next, unrelated one.
 */
export function QualitySelect({ mediaType, value, onChange, compact = false }: { mediaType: Kind; value: string; onChange: (value: string) => void; compact?: boolean }) {
  const [info, setInfo] = useState(cache.get(mediaType) ?? null);

  useEffect(() => {
    let alive = true;
    if (cache.has(mediaType)) { setInfo(cache.get(mediaType)!); return; }
    api.qualityProfiles(mediaType)
      .then(r => { const v = { profiles: r.profiles.map(p => p.name), defaultName: r.defaultName }; cache.set(mediaType, v); if (alive) setInfo(v); })
      .catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [mediaType]);

  if (!info || info.profiles.length < 2) return null;
  return (
    <label className={`quality-select${compact ? ' quality-select--compact' : ''}`}>
      <span>Quality</span>
      <select
        className="settings-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="Download quality"
      >
        <option value="">Default ({info.defaultName})</option>
        {info.profiles.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
  );
}
