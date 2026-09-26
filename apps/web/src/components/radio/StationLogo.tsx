import { useEffect, useState } from 'react';
import type { RadioStation } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

/** The station's own picture (through this server), or a neutral radio icon when it has none or it does not load. */
export function StationLogo({ station, className }: { station: RadioStation; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [station.id]);
  return (
    <span className={`sl${className ? ` ${className}` : ''}`}>
      {station.logo && !failed
        ? <img src={`/api/radio/logo/${station.id}`} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <SvgIcon name="radio" size={22} />}
    </span>
  );
}
