import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { getPreferredQuality, setPreferredQuality } from '../../lib/quality';

type Kind = 'movie' | 'series' | 'artist';
const cache = new Map<Kind, { profiles: string[]; defaultName: string }>();

/** Dropdown of the quality profiles the media service really has (e.g. HD-1080p, Ultra-HD). */
export function QualitySelect({ mediaType, compact = false }: { mediaType: Kind; compact?: boolean }) {
  const [info, setInfo] = useState(cache.get(mediaType) ?? null);
  const [value, setValue] = useState(getPreferredQuality(mediaType));

  useEffect(() => {
    let alive = true;
    setValue(getPreferredQuality(mediaType));
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
        onChange={e => { setValue(e.target.value); setPreferredQuality(mediaType, e.target.value); }}
        aria-label="Download quality"
      >
        <option value="">Default ({info.defaultName})</option>
        {info.profiles.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
  );
}
