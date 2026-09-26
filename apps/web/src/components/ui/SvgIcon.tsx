import type { ReactNode } from 'react';

export type IconName =
  | 'close' | 'check' | 'star' | 'heart' | 'heart-outline' | 'arrow-left' | 'play' | 'pause' | 'prev' | 'next' | 'stop'
  | 'shuffle' | 'repeat' | 'volume-high' | 'volume-low' | 'volume-mute' | 'sliders' | 'dice' | 'film' | 'tv' | 'mic'
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'plus' | 'pip' | 'chevron-up' | 'queue' | 'repeat-one' | 'music-note' | 'more' | 'image' | 'search' | 'trash' | 'sparkle' | 'youtube' | 'sliders-h' | 'users' | 'edit' | 'eye' | 'eye-off' | 'home' | 'film-tab' | 'tv-tab' | 'note-tab' | 'grid';

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
  'chevron-up': { body: <path d="m6 15 6-6 6 6" /> },
  queue: { body: <path d="M4 6h12M4 11h12M4 16h7M17 14v6l5-3z" /> },
  'repeat-one': { body: <><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /><path d="M11 10h1.5v5" /></> },
  'music-note': { body: <path d="M9 18V6l11-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" /> },
  more: { fill: true, body: <><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></> },
  image: { body: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 4 4 3-3 4 4" /></> },
  search: { body: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></> },
  trash: { body: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /> },
  sparkle: { body: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /> },
  youtube: { body: <><rect x="3" y="6" width="18" height="12" rx="4" /><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" /></> },
  'sliders-h': { body: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" /> },
  users: { body: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0M16 5.2a3.2 3.2 0 0 1 0 6M18 14.5a6 6 0 0 1 3 5.5" /></> },
  edit: { body: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /> },
  eye: { body: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></> },
  'eye-off': { body: <><path d="M3 3l18 18M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4M6.2 7.4A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.8-.8" /><path d="M10 10a2.8 2.8 0 0 0 4 4" /></> },
  home: { body: <path d="M4 11 12 4l8 7M6 10v10h4v-6h4v6h4V10" /> },
  'film-tab': { body: <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4" /></> },
  'tv-tab': { body: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="m8 3 4 3 4-3" /></> },
  'note-tab': { body: <path d="M9 18V6l11-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" /> },
  grid: { body: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></> },
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
