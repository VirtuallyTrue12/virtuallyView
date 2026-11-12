import type { RadioNow, RadioStation } from '../../lib/api';

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const cap = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

/** "News · Hindi": the station's main topic and language. */
export function kindLine(s: RadioStation): string {
  return [cap(s.topics?.[0] ?? s.tags[0] ?? ''), cap(s.language?.split(',')[0]?.trim() ?? '')].filter(Boolean).join(' · ');
}

/** The big line and the small line for a playing station. What the station says is on describes the live edge, so it only shows there. */
export function nowLines(station: RadioStation, now: RadioNow | null, behind: number): { title: string; sub: string } {
  const here = behind === 0 ? now : null;
  return {
    title: here?.song ?? here?.title ?? station.name,
    sub: here?.song ? [here.artist, station.name].filter(Boolean).join(' · ') : here?.title ? station.name : [station.state, station.country].filter(Boolean).join(', ')
  };
}
