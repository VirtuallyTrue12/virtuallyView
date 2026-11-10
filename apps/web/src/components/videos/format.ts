/** Small formatters shared by the Videos pages. */

export const duration = (seconds: number): string => {
  if (!seconds) return '';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

const short = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
export const views = (n: number): string => (n ? `${short(n)} views` : '');
export const subscribers = (n: number): string => (n ? `${short(n)} subscribers` : '');

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3600], ['minute', 60]];
const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;
export const age = (iso?: string): string => {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at) || !rtf) return '';
  const secs = (at - Date.now()) / 1000;
  const unit = UNITS.find(([, size]) => Math.abs(secs) >= size);
  return unit ? rtf.format(Math.round(secs / unit[1]), unit[0]) : 'just now';
};

export const bytes = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

export const watchPath = (id: string) => `/videos/watch/${encodeURIComponent(id)}`;
export const channelPath = (id: string) => `/videos/channel/${encodeURIComponent(id)}`;
