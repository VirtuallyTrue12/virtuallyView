// Pure decisions for saving to a device: quality choices, size estimates, and what "keep the next N" should do.

export type OfflineQuality = 'small' | 'standard' | 'high';

/** Target bitrates (video + audio, kilobits a second) the server converts to; used only for the size guess. */
export const QUALITY_INFO: Record<OfflineQuality, { label: string; height: number; kbps: number }> = {
  small: { label: 'Smaller', height: 480, kbps: 900 },
  standard: { label: 'Standard', height: 720, kbps: 2000 },
  high: { label: 'High', height: 1080, kbps: 4500 }
};
export const QUALITY_ORDER: OfflineQuality[] = ['small', 'standard', 'high'];

const QUALITY_KEY = 'vv-offline-quality';

/** Estimated file size in bytes, or null when the length is unknown. */
export function estimateBytes(durationSeconds: number | null | undefined, quality: OfflineQuality): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  return Math.round(durationSeconds * QUALITY_INFO[quality].kbps * 1000 / 8);
}

/** "Smaller (480p, about 450 MB)"; the size is left out when it cannot be guessed. */
export function qualityLabel(quality: OfflineQuality, bytes: number | null, format: (b: number) => string): string {
  const { label, height } = QUALITY_INFO[quality];
  return `${label} (${height}p${bytes ? `, about ${format(bytes)}` : ''})`;
}

/** The last quality the viewer picked; Standard when they never chose. */
export function lastQuality(): OfflineQuality {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === 'small' || v === 'standard' || v === 'high') return v;
  } catch { /* storage blocked */ }
  return 'standard';
}

export function rememberQuality(quality: OfflineQuality): void {
  try { localStorage.setItem(QUALITY_KEY, quality); } catch { /* storage blocked */ }
}

export interface PlanEpisode { id: string; hasFile: boolean; watched: boolean }

/**
 * "Keep the next N episodes": `episodes` is one series in watching order. Watched episodes that are on the
 * device go; the first N unwatched episodes that have a file are wanted, and the ones not yet saved are fetched.
 */
export function keepNextPlan(episodes: PlanEpisode[], saved: ReadonlySet<string>, count: number): { remove: string[]; fetch: string[] } {
  const remove = episodes.filter(e => e.watched && saved.has(e.id)).map(e => e.id);
  const wanted = episodes.filter(e => !e.watched && e.hasFile).slice(0, Math.max(0, count));
  return { remove, fetch: wanted.filter(e => !saved.has(e.id)).map(e => e.id) };
}
