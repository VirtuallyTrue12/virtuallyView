import type { MediaRatings, RatingScore } from '@virtuallyview/types';

type RawScore = { value?: number; votes?: number } | undefined;

/** One score as the media manager sent it, or undefined when it is missing or zero. */
function scoreOf(raw: RawScore): RatingScore | undefined {
  if (!raw || typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value <= 0) return undefined;
  return typeof raw.votes === 'number' ? { value: raw.value, votes: raw.votes } : { value: raw.value };
}

/** Radarr keeps one score per site: imdb, tmdb, rottenTomatoes, metacritic. Empty ones are left out. */
export function radarrRatings(raw: { imdb?: RawScore; tmdb?: RawScore; rottenTomatoes?: RawScore; metacritic?: RawScore } | undefined): MediaRatings | undefined {
  const ratings: MediaRatings = {};
  const imdb = scoreOf(raw?.imdb);
  const tmdb = scoreOf(raw?.tmdb);
  const rottenTomatoes = scoreOf(raw?.rottenTomatoes);
  const metacritic = scoreOf(raw?.metacritic);
  if (imdb) ratings.imdb = imdb;
  if (tmdb) ratings.tmdb = tmdb;
  if (rottenTomatoes) ratings.rottenTomatoes = rottenTomatoes;
  if (metacritic) ratings.metacritic = metacritic;
  return Object.keys(ratings).length ? ratings : undefined;
}

/** Sonarr sends one score, which comes from TheTVDB. */
export function sonarrRatings(raw: RawScore): MediaRatings | undefined {
  const tvdb = scoreOf(raw);
  return tvdb ? { tvdb } : undefined;
}
