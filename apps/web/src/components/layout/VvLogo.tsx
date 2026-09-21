type VvLogoProps = {
  /** Kept for existing call sites; there is one mark. */
  variant?: 'tile' | 'chevrons';
  size?: number;
  className?: string;
};

/** virtuallyView mark: a house with a play button cut into it (your media, at home). */
export function VvLogo({ size = 28, className = '' }: VvLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="vv-logo-grad" x1="8" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f3cf86" />
          <stop offset="0.55" stopColor="#d4a24e" />
          <stop offset="1" stopColor="#b56d1d" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#vv-logo-grad)" />
      <path
        fill="#0d0f18"
        fillRule="evenodd"
        d="M32 11.5 52.5 27.6a1.6 1.6 0 0 1 .6 1.3V49a3.5 3.5 0 0 1-3.5 3.5h-35A3.5 3.5 0 0 1 11 49V28.9a1.6 1.6 0 0 1 .6-1.3L32 11.5ZM27 29.5v15.2a1 1 0 0 0 1.5.9l12.4-7.6a1 1 0 0 0 0-1.7L28.5 28.6a1 1 0 0 0-1.5.9Z"
      />
    </svg>
  );
}
