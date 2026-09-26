import type { ReactNode } from 'react';

export type IconName =
  | 'close' | 'check' | 'star' | 'heart' | 'heart-outline' | 'arrow-left' | 'play' | 'pause' | 'prev' | 'next' | 'stop'
  | 'shuffle' | 'repeat' | 'volume-high' | 'volume-low' | 'volume-mute' | 'sliders' | 'dice' | 'film' | 'tv' | 'mic'
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'plus' | 'pip' | 'chevron-up' | 'queue' | 'repeat-one' | 'music-note' | 'more' | 'image' | 'search' | 'trash' | 'sparkle' | 'youtube' | 'sliders-h' | 'users' | 'edit' | 'eye' | 'eye-off' | 'home' | 'film-tab' | 'tv-tab' | 'note-tab' | 'grid'
  | 'download' | 'upload' | 'share' | 'clock' | 'calendar' | 'refresh' | 'folder' | 'book' | 'radio' | 'globe' | 'wrench' | 'lock' | 'key' | 'bell' | 'palette' | 'hdd' | 'activity' | 'chart' | 'info' | 'alert' | 'external' | 'list' | 'cast' | 'gear' | 'user' | 'shield' | 'cloud' | 'zap' | 'camera' | 'layers' | 'filter' | 'arrow-right' | 'sun' | 'moon' | 'history' | 'copy' | 'wifi' | 'pin' | 'flag' | 'maximize' | 'minimize' | 'tag' | 'server' | 'plug' | 'bolt';

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
  pip: { body: <><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" /></> },
  download: { body: <path d="M12 3v12m0 0-4-4m4 4 4-4M4 20h16" /> },
  upload: { body: <path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" /> },
  share: { body: <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" /> },
  clock: { body: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></> },
  calendar: { body: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /></> },
  refresh: { body: <path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" /> },
  folder: { body: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> },
  book: { body: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 0 2 2h13" /> },
  radio: { body: <><circle cx="12" cy="12" r="2" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4m8.4-8.4a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2m14.2-14.2a10 10 0 0 1 0 14.2" /></> },
  globe: { body: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></> },
  wrench: { body: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.2-.4-.4-2.2z" /> },
  lock: { body: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></> },
  key: { body: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9m-3 3 3 3m-6-3 2 2" /></> },
  bell: { body: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21a2 2 0 0 0 4 0" /> },
  palette: { body: <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-2-.4-1 .3-2 1.4-2H17a4 4 0 0 0 4-4c0-5-4-10-9-10z" /> },
  hdd: { body: <><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M3 13l3-8h12l3 8M7 16.5h.01" /></> },
  activity: { body: <path d="M3 12h4l3-8 4 16 3-8h4" /> },
  chart: { body: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" /> },
  info: { body: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></> },
  alert: { body: <path d="M12 3 2.5 20h19zM12 10v4m0 3h.01" /> },
  external: { body: <path d="M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /> },
  list: { body: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /> },
  cast: { body: <path d="M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M3 12a8 8 0 0 1 8 8M3 16a4 4 0 0 1 4 4M3 20h.01" /> },
  gear: { body: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></> },
  user: { body: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></> },
  shield: { body: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /> },
  cloud: { body: <path d="M7 18a5 5 0 0 1-.5-10 6 6 0 0 1 11.4 1.6A4.2 4.2 0 0 1 17.5 18z" /> },
  zap: { body: <path d="M13 2 4 14h7l-1 8 9-12h-7z" /> },
  camera: { body: <><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="3.5" /></> },
  layers: { body: <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5" /> },
  filter: { body: <path d="M3 5h18l-7 8v6l-4 2v-8z" /> },
  'arrow-right': { body: <path d="M5 12h14m-6-6 6 6-6 6" /> },
  sun: { body: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></> },
  moon: { body: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" /> },
  history: { body: <path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-4v4h4M12 7v5l3 2" /> },
  copy: { body: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></> },
  wifi: { body: <path d="M2 9a15 15 0 0 1 20 0M5 12.5a10.5 10.5 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0M12 20h.01" /> },
  pin: { body: <><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></> },
  flag: { body: <path d="M5 21V4m0 0h11l-2 4 2 4H5" /> },
  maximize: { body: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /> },
  minimize: { body: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> },
  tag: { body: <path d="M3 12V4h8l10 10-8 8zM7.5 8h.01" /> },
  server: { body: <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></> },
  plug: { body: <path d="M9 2v6m6-6v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5" /> },
  bolt: { body: <path d="M13 2 4 14h7l-1 8 9-12h-7z" /> },
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
