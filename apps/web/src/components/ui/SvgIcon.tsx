import type { ReactNode } from 'react';

export type IconName =
  | 'close' | 'check' | 'star' | 'heart' | 'heart-outline' | 'arrow-left' | 'play' | 'pause' | 'prev' | 'next' | 'stop'
  | 'shuffle' | 'repeat' | 'volume-high' | 'volume-low' | 'volume-mute' | 'sliders' | 'dice' | 'film' | 'tv' | 'mic'
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'plus' | 'pip';

const speaker = <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" stroke="none" />;

const ICONS: Record<IconName, { fill?: boolean; body: ReactNode }> = {
  close: { body: <path d="M6 6l12 12M18 6 6 18" /> },
  check: { body: <path d="m5 12.5 4.5 4.5L19 7.5" /> },
  star: { fill: true, body: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" /> },
  heart: { fill: true, body: <path d="M12 20s-7-4.6-9-9.2C1.6 7.4 3.6 4.5 6.6 4.5c1.9 0 3.5 1 5.4 3 1.9-2 3.5-3 5.4-3 3 0 5 2.9 3.6 6.3-2 4.6-9 9.2-9 9.2z" /> },
  'heart-outline': { body: <path d="M12 20s-7-4.6-9-9.2C1.6 7.4 3.6 4.5 6.6 4.5c1.9 0 3.5 1 5.4 3 1.9-2 3.5-3 5.4-3 3 0 5 2.9 3.6 6.3-2 4.6-9 9.2-9 9.2z" /> },
  'arrow-left': { body: <path d="M19 12H5m6-6-6 6 6 6" /> },
  play: { fill: true, body: <path d="M8 5v14l11-7z" /> },
  pause: { fill: true, body: <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> },
  prev: { fill: true, body: <path d="M6 5h2v14H6zM20 5v14L9 12z" /> },
  next: { fill: true, body: <path d="M16 5h2v14h-2zM4 5v14l11-7z" /> },
  stop: { fill: true, body: <path d="M6 6h12v12H6z" /> },
  shuffle: { body: <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /> },
  repeat: { body: <path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /> },
  'volume-high': { body: <>{speaker}<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></> },
  'volume-low': { body: <>{speaker}<path d="M15.5 8.5a5 5 0 0 1 0 7" /></> },
  'volume-mute': { body: <>{speaker}<path d="m16 9 6 6m0-6-6 6" /></> },
  sliders: { body: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /> },
  dice: { body: <><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /></> },
  film: { body: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></> },
  tv: { body: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="m8 3 4 3 4-3M8 21h8" /></> },
  mic: { body: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></> },
  'chevron-left': { body: <path d="m15 6-6 6 6 6" /> },
  'chevron-right': { body: <path d="m9 6 6 6-6 6" /> },
  'chevron-down': { body: <path d="m6 9 6 6 6-6" /> },
  plus: { body: <path d="M12 5v14M5 12h14" /> },
  pip: { body: <><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" /></> }
};

/** Small inline SVG icon that inherits the surrounding text color. */
export function SvgIcon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const icon = ICONS[name];
  return (
    <svg
      className={`svg-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={icon.fill ? 'currentColor' : 'none'}
      stroke={icon.fill ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon.body}
    </svg>
  );
}
