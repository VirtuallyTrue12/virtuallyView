import type { EpisodeItem, MediaItem } from './api';

export type Where =
  | { kind: 'resume'; episode: EpisodeItem; minutesLeft: number }
  | { kind: 'next' | 'start'; episode: EpisodeItem }
  | null;

const order = (a: EpisodeItem, b: EpisodeItem) => (a.seasonNumber || 999) - (b.seasonNumber || 999) || a.episodeNumber - b.episodeNumber;
const partly = (e: EpisodeItem) => (e.watchProgress ?? 0) > 0 && (e.watchProgress ?? 0) < 96;
const done = (e: EpisodeItem) => e.watched === true || (e.watchProgress ?? 0) >= 96;

/** Where to pick a show up: finish a half-watched episode, else the one after the last finished, else the first. */
export function whereYouLeftOff(episodes: EpisodeItem[]): Where {
  const playable = episodes.filter(e => e.hasFile).sort(order);
  if (!playable.length) return null;
  const partial = playable.find(partly);
  if (partial) {
    const left = (partial.runtime ?? 0) * (1 - (partial.watchProgress ?? 0) / 100);
    return { kind: 'resume', episode: partial, minutesLeft: Math.max(1, Math.round(left)) };
  }
  const lastDone = playable.reduce((at, e, i) => (done(e) ? i : at), -1);
  if (lastDone < 0) return { kind: 'start', episode: playable[0] };
  // Everything watched: start again from the top.
  return playable[lastDone + 1] ? { kind: 'next', episode: playable[lastDone + 1] } : { kind: 'start', episode: playable[0] };
}

/** Other parts of the same collection (by the name Radarr gives it), oldest first. Empty when there is none. */
export function collectionParts(movie: MediaItem, library: MediaItem[]): MediaItem[] {
  if (!movie.collection) return [];
  const when = (m: MediaItem) => m.releaseDate || (m.year ? `${m.year}` : '9999');
  return library.filter(m => m.id !== movie.id && m.collection === movie.collection)
    .sort((a, b) => when(a).localeCompare(when(b)) || a.title.localeCompare(b.title));
}
