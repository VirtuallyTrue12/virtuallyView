/**
 * Year in Review: a pure aggregation over one year of plays and finished videos.
 * Years are read in UTC, the same way the server stores times.
 */

export interface ReviewPlay {
  trackId: string;
  title: string;
  artist: string;
  genre?: string | null;
  durationMs: number;
  playedAt: string;
}

export interface ReviewFilm {
  id: string;
  title: string;
  finishedAt: string;
  rating?: number;
}

export interface ReviewEpisode {
  seriesId: string;
  seriesTitle: string;
  finishedAt: string;
}

export interface YearReview {
  year: number;
  totals: { plays: number; films: number; episodes: number };
  minutesListened: number;
  topArtists: Array<{ name: string; plays: number }>;
  topSongs: Array<{ title: string; artist: string; plays: number }>;
  topGenre: { name: string; plays: number } | null;
  topFilms: Array<{ title: string; finishedAt: string }>;
  topShows: Array<{ title: string; episodes: number }>;
  firstPlay: { title: string; artist: string; playedAt: string } | null;
}

export interface ReviewInput {
  year: number;
  plays: ReviewPlay[];
  films: ReviewFilm[];
  episodes: ReviewEpisode[];
}

const TOP = 5;
const TOP_FILMS = 3;
const TOP_SHOWS = 3;

const inYear = (iso: string, year: number): boolean => iso.slice(0, 4) === String(year);

/** Counts per key, most first; ties keep the first one seen. */
function tally<T>(items: T[], keyOf: (item: T) => string | null, labelOf: (item: T) => string): Array<{ key: string; label: string; count: number }> {
  const map = new Map<string, { key: string; label: string; count: number }>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const hit = map.get(key);
    if (hit) hit.count++;
    else map.set(key, { key, label: labelOf(item), count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function yearInReview(input: ReviewInput): YearReview {
  const { year } = input;
  const plays = input.plays.filter(p => inYear(p.playedAt, year) && Number.isFinite(Date.parse(p.playedAt)));
  const films = input.films.filter(f => inYear(f.finishedAt, year));
  const episodes = input.episodes.filter(e => inYear(e.finishedAt, year));

  const minutes = Math.round(plays.reduce((sum, p) => sum + (Number(p.durationMs) || 0), 0) / 60000);

  const topArtists = tally(plays, p => p.artist.trim() || null, p => p.artist.trim()).slice(0, TOP)
    .map(a => ({ name: a.label, plays: a.count }));

  const topSongs = tally(plays, p => p.trackId, p => `${p.title}\u0000${p.artist}`).slice(0, TOP)
    .map(s => {
      const [title = '', artist = ''] = s.label.split('\u0000');
      return { title, artist, plays: s.count };
    });

  const genre = tally(plays, p => p.genre?.trim() || null, p => p.genre!.trim())[0];

  // Films rated higher come first; unrated ones follow in the order they were finished.
  const topFilms = [...films]
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (a.finishedAt < b.finishedAt ? 1 : -1))
    .slice(0, TOP_FILMS)
    .map(f => ({ title: f.title, finishedAt: f.finishedAt }));

  const topShows = tally(episodes, e => e.seriesId, e => e.seriesTitle)
    .slice(0, TOP_SHOWS)
    .map(s => ({ title: s.label, episodes: s.count }));

  const first = [...plays].sort((a, b) => (a.playedAt < b.playedAt ? -1 : a.playedAt > b.playedAt ? 1 : 0))[0];

  return {
    year,
    totals: { plays: plays.length, films: films.length, episodes: episodes.length },
    minutesListened: minutes,
    topArtists,
    topSongs,
    topGenre: genre ? { name: genre.label, plays: genre.count } : null,
    topFilms,
    topShows,
    firstPlay: first ? { title: first.title, artist: first.artist, playedAt: first.playedAt } : null
  };
}
