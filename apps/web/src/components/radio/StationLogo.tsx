import { useEffect, useState } from 'react';
import type { RadioStation } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

const initials = (name: string) => name.replace(/\b(radio|fm|am|the|hd)\b/gi, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
const hue = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** The station's own picture (through this server), or its initials on a colour picked from its name. */
export function StationLogo({ station, className, large }: { station: RadioStation; className?: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [station.id]);
  return (
    <span className={`sl${large ? ' sl--large' : ''}${className ? ` ${className}` : ''}`}>
      {station.logo && !failed
        ? <img src={`/api/radio/logo/${station.id}`} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span className="sl-initials" style={{ background: `linear-gradient(150deg, hsl(${hue(station.name)} 45% 32%), hsl(${(hue(station.name) + 40) % 360} 50% 20%))` }} aria-hidden="true">{initials(station.name) || <SvgIcon name="radio" size={20} />}</span>}
    </span>
  );
}
