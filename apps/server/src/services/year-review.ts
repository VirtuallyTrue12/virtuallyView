/**
 * Year in Review maths. Music is summed in SQL (that table grows without bound); finished titles and
 * videos are small, so they are read as rows and counted here. Everything is per viewer.
 * Calendar years are UTC, like the stored times. Day and hour use the viewer's own offset (`tzMin`).
 */

export type Query = <T>(sql: string, ...params: Array<string | number>) => T[];

export interface Ranked { name: string; count: number; image?: string | null }
export interface Moment { kind: 'song' | 'film' | 'episode' | 'video'; title: string; at: string }

export interface MusicStats {
  plays: number;
  minutes: number;
  artists: Array<{ name: string; artistId: string | null; plays: number }>;
  songs: Array<{ title: string; artist: string; plays: number }>;
  genres: Array<{ name: string; plays: number }>;
  weekdays: number[];
  hours: number[];
  first: Moment | null;
  last: Moment | null;
}

export interface Finished { id: string; seriesId?: string | null; title: string; at: string; minutes: number; rating?: number; poster?: string | null; genres?: string[] }
export interface Watched { id: string; channel: string; channelThumb?: string | null; at: string; seconds: number }

const pad = (n: number) => String(n).padStart(2, '0');
/** The viewer's local clock for an ISO time: weekday 0-6 (Sunday first), hour 0-23, and the calendar day. */
export function localParts(iso: string, tzMin: number): { weekday: number; hour: number; day: string } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + tzMin * 60000);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours(), day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` };
}

/** Counts per key, most first; ties keep the first one seen. */
export function topBy<T>(items: T[], keyOf: (i: T) => string | null | undefined, labelOf: (i: T) => string, limit = 5): Array<{ key: string; label: string; count: number }> {
  const map = new Map<string, { key: string; label: string; count: number }>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const hit = map.get(key);
    if (hit) hit.count++;
    else map.set(key, { key, label: labelOf(item), count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/** The most episodes of one show on one calendar day. */
export function longestBinge(episodes: Finished[], tzMin: number): { title: string; episodes: number; day: string } | null {
  const perDay = new Map<string, { title: string; day: string; n: number }>();
  let best: { title: string; episodes: number; day: string } | null = null;
  for (const e of episodes) {
    const p = localParts(e.at, tzMin);
    if (!p || !e.seriesId) continue;
    const key = `${p.day}|${e.seriesId}`;
    const hit = perDay.get(key) ?? { title: e.title, day: p.day, n: 0 };
    hit.n++;
    perDay.set(key, hit);
    if (!best || hit.n > best.episodes) best = { title: hit.title, episodes: hit.n, day: hit.day };
  }
  return best;
}

/** Counts per weekday and per hour across the given times, and the busiest of each (null when there are none). */
export function busiest(times: string[], tzMin: number, seed?: { weekdays: number[]; hours: number[] }) {
  const weekdays = seed ? [...seed.weekdays] : Array<number>(7).fill(0);
  const hours = seed ? [...seed.hours] : Array<number>(24).fill(0);
  for (const t of times) {
    const p = localParts(t, tzMin);
    if (!p) continue;
    weekdays[p.weekday]++;
    hours[p.hour]++;
  }
  const peak = (a: number[]) => a.reduce((best, v, i) => (v > a[best]! ? i : best), 0);
  if (!weekdays.some(Boolean)) return null;
  return { weekday: peak(weekdays), hour: peak(hours), weekdays, hours };
}

/** Earliest and latest of a set of moments. */
export function firstAndLast(moments: Array<Moment | null>): { first: Moment; last: Moment } | null {
  const list = moments.filter((m): m is Moment => !!m && Number.isFinite(Date.parse(m.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return list.length ? { first: list[0]!, last: list[list.length - 1]! } : null;
}

/** Music totals for one viewer and year, summed by SQLite. `tzMin` shifts day and hour to the viewer's clock. */
export function musicStats(query: Query, userId: string, year: number, tzMin: number): MusicStats {
  const from = `${year}-01-01T00:00:00.000Z`;
  const to = `${year + 1}-01-01T00:00:00.000Z`;
  const where = 'user_id = ? AND played_at >= ? AND played_at < ?';
  const args = [userId, from, to];
  const total = query<{ n: number; ms: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(duration_ms), 0) AS ms FROM music_plays WHERE ${where}`, ...args)[0]!;
  const empty: MusicStats = { plays: 0, minutes: 0, artists: [], songs: [], genres: [], weekdays: Array(7).fill(0), hours: Array(24).fill(0), first: null, last: null };
  if (!total.n) return empty;
  const artists = query<{ name: string; artistId: string | null; plays: number }>(
    `SELECT TRIM(artist) AS name, MAX(artist_id) AS artistId, COUNT(*) AS plays FROM music_plays WHERE ${where} AND TRIM(artist) <> ''
     GROUP BY LOWER(TRIM(artist)) ORDER BY plays DESC, MIN(played_at) LIMIT 5`, ...args);
  const songs = query<{ title: string; artist: string; plays: number }>(
    `SELECT MAX(title) AS title, MAX(artist) AS artist, COUNT(*) AS plays FROM music_plays WHERE ${where}
     GROUP BY track_id ORDER BY plays DESC, MIN(played_at) LIMIT 5`, ...args);
  const genres = query<{ name: string; plays: number }>(
    `SELECT TRIM(genre) AS name, COUNT(*) AS plays FROM music_plays WHERE ${where} AND genre IS NOT NULL AND TRIM(genre) <> ''
     GROUP BY LOWER(TRIM(genre)) ORDER BY plays DESC LIMIT 6`, ...args);
  // Day and hour through SQLite's own clock maths, so no row ever leaves the database.
  const shift = `datetime(played_at, '${tzMin >= 0 ? '+' : '-'}${Math.abs(Math.trunc(tzMin))} minutes')`;
  const weekdays = Array<number>(7).fill(0);
  const hours = Array<number>(24).fill(0);
  for (const r of query<{ w: number; n: number }>(`SELECT CAST(strftime('%w', ${shift}) AS INTEGER) AS w, COUNT(*) AS n FROM music_plays WHERE ${where} GROUP BY w`, ...args)) weekdays[r.w] = r.n;
  for (const r of query<{ h: number; n: number }>(`SELECT CAST(strftime('%H', ${shift}) AS INTEGER) AS h, COUNT(*) AS n FROM music_plays WHERE ${where} GROUP BY h`, ...args)) hours[r.h] = r.n;
  const edge = (order: 'ASC' | 'DESC'): Moment | null => {
    const r = query<{ title: string; artist: string; at: string }>(`SELECT title, artist, played_at AS at FROM music_plays WHERE ${where} ORDER BY played_at ${order} LIMIT 1`, ...args)[0];
    return r ? { kind: 'song', title: r.artist ? `${r.title} by ${r.artist}` : r.title, at: r.at } : null;
  };
  return { plays: total.n, minutes: Math.round(total.ms / 60000), artists, songs, genres, weekdays, hours, first: edge('ASC'), last: edge('DESC') };
}

export interface ReviewInput {
  year: number;
  tzMin: number;
  music: MusicStats;
  films: Finished[];
  episodes: Finished[];
  videos: Watched[];
  artistImages?: Map<string, string>;
}

export interface YearReview {
  year: number;
  empty: boolean;
  totals: { plays: number; films: number; episodes: number; videos: number };
  hours: { listened: number; watched: number; videos: number; total: number };
  topArtists: Array<{ name: string; plays: number; image: string | null }>;
  topSongs: Array<{ title: string; artist: string; plays: number }>;
  musicGenres: Array<{ name: string; plays: number }>;
  topFilms: Array<{ title: string; poster: string | null; finishedAt: string }>;
  topShows: Array<{ title: string; poster: string | null; episodes: number }>;
  topChannels: Array<{ name: string; image: string | null; videos: number }>;
  watchGenres: Array<{ name: string; count: number }>;
  busiest: { weekday: number; hour: number; weekdays: number[]; hours: number[] } | null;
  binge: { title: string; episodes: number; day: string } | null;
  first: Moment | null;
  last: Moment | null;
  /** Total hours last year, when there is any data for it; set by the route. */
  previous: { year: number; hours: number } | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function yearInReview(input: ReviewInput): YearReview {
  const { year, tzMin, music, films, episodes, videos } = input;
  const listened = music.minutes / 60;
  const watched = (films.reduce((s, f) => s + f.minutes, 0) + episodes.reduce((s, e) => s + e.minutes, 0)) / 60;
  const videoHours = videos.reduce((s, v) => s + v.seconds, 0) / 3600;

  const topFilms = [...films]
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (a.at < b.at ? 1 : -1))
    .slice(0, 5).map(f => ({ title: f.title, poster: f.poster ?? null, finishedAt: f.at }));
  const poster = new Map(episodes.map(e => [e.seriesId ?? '', e.poster ?? null]));
  const topShows = topBy(episodes, e => e.seriesId, e => e.title).map(s => ({ title: s.label, poster: poster.get(s.key) ?? null, episodes: s.count }));
  const thumb = new Map(videos.map(v => [v.channel, v.channelThumb ?? null]));
  const topChannels = topBy(videos, v => v.channel.trim().toLowerCase(), v => v.channel.trim()).map(c => ({ name: c.label, image: thumb.get(c.label) ?? null, videos: c.count }));

  // Genres of titles watched: each film once, each show once (not once per episode).
  const shows = [...new Map(episodes.map(e => [e.seriesId, e])).values()];
  const watchGenres = topBy([...films, ...shows].flatMap(t => (t.genres ?? []).map(g => g.trim()).filter(Boolean)), g => g.toLowerCase(), g => g, 6)
    .map(g => ({ name: g.label, count: g.count }));

  const seed = { weekdays: music.weekdays, hours: music.hours };
  const busy = busiest([...films, ...episodes].map(f => f.at).concat(videos.map(v => v.at)), tzMin, seed);
  const fl = firstAndLast([
    music.first, music.last,
    ...[...films.map(f => ({ kind: 'film' as const, title: f.title, at: f.at })), ...episodes.map(e => ({ kind: 'episode' as const, title: e.title, at: e.at }))],
    ...videos.map(v => ({ kind: 'video' as const, title: v.channel, at: v.at }))
  ]);
  const total = listened + watched + videoHours;
  const empty = music.plays + films.length + episodes.length + videos.length === 0;
  return {
    year, empty,
    totals: { plays: music.plays, films: films.length, episodes: episodes.length, videos: videos.length },
    hours: { listened: round1(listened), watched: round1(watched), videos: round1(videoHours), total: round1(total) },
    topArtists: music.artists.map(a => ({ name: a.name, plays: a.plays, image: (a.artistId && input.artistImages?.get(a.artistId)) || null })),
    topSongs: music.songs,
    musicGenres: music.genres,
    topFilms, topShows, topChannels, watchGenres,
    busiest: busy,
    binge: longestBinge(episodes, tzMin),
    first: fl?.first ?? null,
    last: fl && fl.last.at !== fl.first.at ? fl.last : null,
    previous: null
  };
}
