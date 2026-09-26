import { all, get, run } from '../db/app-db.js';
import { artistGuesses, classifyMusicVideo, resolveArtist, type FilerDeps } from './music-videos.js';

/**
 * A concert of a band that is added as a film (through Radarr, which is where
 * "Linkin Park - Live at Rock am Ring" lives on TMDB) belongs with the band, not
 * among the films. Such a film is filed under its artist's Concerts, kept out of
 * the Movies lists, and still plays through the normal film player.
 */

export interface MovieLike { id: string; title: string; year?: number; genres?: string[]; status?: string }

interface Row { movie_id: string; artist_id: number | null; artist_name: string | null; checked_at: string }

/** Cheap first check: does this film look like a concert at all? Genre "Music" alone also covers musicals, so an artist must match too. */
export function looksLikeConcert(movie: Pick<MovieLike, 'title' | 'genres'>): boolean {
  return classifyMusicVideo(movie.title) !== null || (movie.genres ?? []).some(g => /^music$/i.test(g));
}

let cache: { at: number; map: Map<string, { artistId: number; artistName: string }> } | null = null;

function load(): Map<string, { artistId: number; artistName: string }> {
  if (cache && Date.now() - cache.at < 5000) return cache.map;
  const map = new Map<string, { artistId: number; artistName: string }>();
  for (const r of all<Row>('SELECT movie_id, artist_id, artist_name, checked_at FROM concert_movies WHERE artist_id IS NOT NULL')) {
    map.set(r.movie_id, { artistId: r.artist_id!, artistName: r.artist_name ?? '' });
  }
  cache = { at: Date.now(), map };
  return map;
}

export const concertMovieIds = (): Set<string> => new Set(load().keys());

/** The films list without the concerts that have moved to their artist. */
export function withoutConcerts<T extends { id: string }>(items: T[]): T[] {
  const moved = load();
  return moved.size === 0 ? items : items.filter(i => !moved.has(i.id));
}

export function concertMoviesOf(artistId: number): string[] {
  return [...load()].filter(([, v]) => v.artistId === artistId).map(([id]) => id);
}

const RECHECK_MS = 7 * 24 * 3_600_000;

/**
 * Looks at films not looked at yet. A concert with a known artist (created when new) is remembered;
 * everything else is remembered as "not a concert" for a week so it is not looked up again every time.
 */
export async function sweepConcertMovies(movies: MovieLike[], deps: Pick<FilerDeps, 'lidarr'>, opts: { onlyTitleBased?: boolean } = {}): Promise<number> {
  let moved = 0;
  for (const movie of movies) {
    if (!looksLikeConcert(movie)) continue;
    if (opts.onlyTitleBased && classifyMusicVideo(movie.title) === null) continue;
    const known = get<Row>('SELECT movie_id, artist_id, artist_name, checked_at FROM concert_movies WHERE movie_id = ?', movie.id);
    if (known && (known.artist_id !== null || Date.now() - Date.parse(known.checked_at) < RECHECK_MS)) continue;
    const guesses = artistGuesses(movie.title);
    const resolved = guesses.length ? await resolveArtist(guesses, deps as FilerDeps).catch(() => ({ failure: 'lookup failed' } as const)) : ({ failure: 'no artist in the title' } as const);
    const artist = 'failure' in resolved ? null : resolved.artist;
    run(`INSERT INTO concert_movies (movie_id, artist_id, artist_name, checked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(movie_id) DO UPDATE SET artist_id = excluded.artist_id, artist_name = excluded.artist_name, checked_at = excluded.checked_at`,
    movie.id, artist?.id ?? null, artist?.name ?? null, new Date().toISOString());
    if (artist) moved++;
  }
  cache = null;
  return moved;
}
