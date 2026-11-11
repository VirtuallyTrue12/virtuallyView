import type { RadarrAdapter } from '@virtuallyview/integrations';
import { all as dbAll } from '../db/app-db.js';
import { getAdapter } from './registry.js';
import { filterByRating } from './parental.js';
import { musicStats, yearInReview, type Finished, type Query, type Watched, type YearReview } from './year-review.js';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: ReviewResponse }>();

export type ReviewResponse = { review: YearReview; years: number[] };

interface Item { id: string; title: string; rating?: number; runtime?: number; genres?: string[]; artwork?: { poster?: string } }
// Titles come from the media services (and respect the profile's age limit). One they no longer have is left out.
const items = async (name: string): Promise<Map<string, Item>> => {
  try {
    const list = (await getAdapter<RadarrAdapter>(name).getItems()) as unknown as Item[];
    return new Map((filterByRating(list as never) as unknown as Item[]).map(i => [i.id, i]));
  } catch { return new Map(); }
};

const query: Query = (sql, ...params) => dbAll(sql, ...params);

/** Years that hold anything for this viewer, newest first. */
function yearsWithData(uid: string): number[] {
  const rows = dbAll<{ y: string }>(
    `SELECT DISTINCT substr(played_at, 1, 4) AS y FROM music_plays WHERE user_id = ?
     UNION SELECT DISTINCT substr(finished_at, 1, 4) FROM watch_finished WHERE user_id = ?
     UNION SELECT DISTINCT substr(at, 1, 4) FROM video_history WHERE user_id = ?`, uid, uid, uid);
  return rows.map(r => Number(r.y)).filter(y => y >= 2000 && y <= 2100).sort((a, b) => b - a);
}

async function build(uid: string, year: number, tzMin: number, withPrevious: boolean): Promise<YearReview> {
  const from = `${year}-01-01T00:00:00.000Z`;
  const to = `${year + 1}-01-01T00:00:00.000Z`;
  const music = musicStats(query, uid, year, tzMin);
  const [movies, shows, artists] = await Promise.all([items('radarr'), items('sonarr'), items('lidarr')]);

  const filmRows = [
    ...dbAll<{ id: string; at: string }>(`SELECT media_id AS id, finished_at AS at FROM watch_finished WHERE user_id = ? AND media_type = 'movie' AND finished_at >= ? AND finished_at < ?`, uid, from, to),
    ...dbAll<{ id: string; at: string }>(`SELECT media_id AS id, updated_at AS at FROM user_flags WHERE user_id = ? AND media_type = 'movie' AND watched = 1 AND updated_at >= ? AND updated_at < ?`, uid, from, to)
  ];
  const seen = new Set<string>();
  const films: Finished[] = [];
  for (const r of filmRows) {
    const m = movies.get(r.id);
    if (!m || seen.has(r.id)) continue;
    seen.add(r.id);
    films.push({ id: r.id, title: m.title, at: r.at, minutes: m.runtime || 100, rating: m.rating, poster: m.artwork?.poster, genres: m.genres });
  }
  const episodes: Finished[] = [];
  for (const r of dbAll<{ id: string; seriesId: string; at: string }>(
    `SELECT media_id AS id, series_id AS seriesId, finished_at AS at FROM watch_finished
     WHERE user_id = ? AND media_type = 'episode' AND series_id IS NOT NULL AND finished_at >= ? AND finished_at < ?`, uid, from, to)) {
    const s = shows.get(r.seriesId);
    if (s) episodes.push({ id: r.id, seriesId: r.seriesId, title: s.title, at: r.at, minutes: s.runtime || 40, poster: s.artwork?.poster, genres: s.genres });
  }
  const videos: Watched[] = dbAll<{ id: string; channel: string | null; thumb: string | null; at: string; seconds: number }>(
    `SELECT video_id AS id, json_extract(snapshot, '$.channel') AS channel, json_extract(snapshot, '$.channelThumb') AS thumb, at, position AS seconds
     FROM video_history WHERE user_id = ? AND at >= ? AND at < ? AND position > 0`, uid, from, to)
    .map(v => ({ id: v.id, channel: v.channel ?? 'Unknown channel', channelThumb: v.thumb, at: v.at, seconds: v.seconds }));

  const artistImages = new Map<string, string>();
  for (const a of music.artists) {
    const poster = a.artistId ? artists.get(a.artistId)?.artwork?.poster : undefined;
    if (a.artistId && poster) artistImages.set(a.artistId, poster);
  }
  const review = yearInReview({ year, tzMin, music, films, episodes, videos, artistImages });
  if (withPrevious) {
    const prev = await build(uid, year - 1, tzMin, false);
    review.previous = prev.empty ? null : { year: year - 1, hours: prev.hours.total };
  }
  return review;
}

/** One viewer's recap, cached for ten minutes per viewer, year and timezone. */
export async function reviewFor(uid: string, year: number, tzMin: number): Promise<ReviewResponse> {
  const key = `${uid}|${year}|${tzMin}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = { review: await build(uid, year, tzMin, true), years: yearsWithData(uid) };
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}
