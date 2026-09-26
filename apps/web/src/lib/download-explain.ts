import type { DoctorEntry } from './api';

const when = (iso: string, now: number): string => {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (minutes <= 1) return 'in a moment';
  if (minutes < 90) return `in about ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  return `in about ${Math.round(minutes / 60)} hours`;
};

/**
 * Plain words for a download that is stuck, and what happens next. The raw text from the download
 * apps ("The download is stalled with no connections") means nothing to most people.
 */
export function explainTrouble(item: { status: string; message?: string }, entry: DoctorEntry | undefined, now = Date.now()): { text: string; tone: 'warn' | 'bad' } | null {
  const next = entry?.needsYou ? entry.needsYou
    : entry?.gaveUp ? 'Several replacements were tried without luck. Add more search sources, or pick a release by hand from Requests.'
    : entry?.fixAt ? `It is replaced automatically ${when(entry.fixAt, now)}.`
    : 'Use Try another release to look for a different one.';
  const kind = entry?.kind ?? (item.status === 'stalled' ? 'stalled' : /downloading metadata/i.test(item.message ?? '') ? 'metadata' : item.status === 'failed' ? 'import' : null);
  if (kind === 'stalled') return { tone: 'warn', text: `Nobody is sharing this file right now. ${next}` };
  if (kind === 'metadata') return { tone: 'warn', text: `Still waiting for the file's details, which usually means nobody is sharing it. ${next}` };
  if (kind === 'import') return { tone: 'bad', text: `It finished, but the files could not be matched to the title. ${next}` };
  if (kind === 'other') return { tone: 'bad', text: next };
  return null;
}
