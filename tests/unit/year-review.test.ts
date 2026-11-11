import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { busiest, firstAndLast, longestBinge, musicStats, topBy, yearInReview, type Finished, type Query } from '../../apps/server/src/services/year-review';

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE music_plays (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, track_id TEXT, artist_id TEXT, album_id TEXT,
  title TEXT, artist TEXT DEFAULT '', genre TEXT, duration_ms INTEGER DEFAULT 0, played_at TEXT)`);
const insert = db.prepare('INSERT INTO music_plays (user_id, track_id, artist_id, title, artist, genre, duration_ms, played_at) VALUES (?,?,?,?,?,?,?,?)');
const play = (user: string, track: string, artist: string, at: string, genre: string | null = 'Rock', ms = 180_000) => insert.run(user, track, null, `T-${track}`, artist, genre, ms, at);
const query: Query = (sql, ...p) => db.prepare(sql).all(...p) as never;

const ep = (series: string, at: string): Finished => ({ id: at + series, seriesId: series, title: `Show ${series}`, at, minutes: 40 });

describe('music stats (SQL)', () => {
  it('is empty for a year with no plays and ignores other users and years', () => {
    play('u2', 'x', 'Other', '2026-05-01T10:00:00Z');
    play('u1', 'old', 'Old', '2025-12-31T23:59:00Z');
    const m = musicStats(query, 'u1', 2026, 0);
    expect(m.plays).toBe(0);
    expect(m.artists).toEqual([]);
    expect(m.first).toBeNull();
  });

  it('ranks top artists and songs, sums minutes and finds the genre', () => {
    for (let i = 0; i < 6; i++) play('u1', 's1', 'Alpha', `2026-02-0${i + 1}T10:00:00Z`, 'Pop');
    for (let i = 0; i < 4; i++) play('u1', 's2', 'Beta', `2026-03-0${i + 1}T10:00:00Z`, 'Pop');
    for (const [i, a] of ['G', 'D', 'E', 'Z', 'H'].entries()) play('u1', `x${i}`, a, `2026-04-0${i + 1}T10:00:00Z`, 'Jazz');
    const m = musicStats(query, 'u1', 2026, 0);
    expect(m.plays).toBe(15);
    expect(m.minutes).toBe(45);
    expect(m.artists).toHaveLength(5);
    expect(m.artists[0]).toMatchObject({ name: 'Alpha', plays: 6 });
    expect(m.songs[0]).toMatchObject({ title: 'T-s1', plays: 6 });
    expect(m.genres[0]).toEqual({ name: 'Pop', plays: 10 });
    expect(m.first?.at).toBe('2026-02-01T10:00:00Z');
    expect(m.last?.at).toBe('2026-04-05T10:00:00Z');
  });

  it('puts weekday and hour on the viewer clock', () => {
    // 2026-02-01 is a Sunday. 23:30 UTC at +60 minutes is Monday 00:30.
    const m = musicStats(query, 'u1', 2026, 60);
    expect(m.weekdays.reduce((a, b) => a + b, 0)).toBe(15);
    const sundayUtc = musicStats(query, 'u1', 2026, 0).weekdays[0];
    expect(sundayUtc).toBeGreaterThan(0);
  });
});

describe('stats maths', () => {
  it('finds the longest binge: most episodes of one show on one day', () => {
    const binge = longestBinge([
      ep('a', '2026-03-01T10:00:00Z'), ep('a', '2026-03-02T10:00:00Z'), ep('a', '2026-03-02T11:00:00Z'),
      ep('b', '2026-03-05T10:00:00Z'), ep('b', '2026-03-05T11:00:00Z'), ep('b', '2026-03-05T12:00:00Z'), ep('a', '2026-03-05T13:00:00Z')
    ], 0);
    expect(binge).toEqual({ title: 'Show b', episodes: 3, day: '2026-03-05' });
    expect(longestBinge([], 0)).toBeNull();
  });

  it('counts a late-night binge as one day on the viewer clock', () => {
    const eps = [ep('a', '2026-03-01T23:00:00Z'), ep('a', '2026-03-02T00:30:00Z')];
    expect(longestBinge(eps, 0)?.episodes).toBe(1);
    expect(longestBinge(eps, 120)?.episodes).toBe(2);
  });

  it('ranks top lists with ties kept in first-seen order', () => {
    const top = topBy(['a', 'b', 'b', 'c', 'c', 'd'], x => x, x => x, 3);
    expect(top.map(t => t.key)).toEqual(['b', 'c', 'a']);
  });

  it('finds the busiest weekday and hour, and nothing for no data', () => {
    // Mon 2026-03-02 x2 at 20:00, Tue 2026-03-03 at 09:00
    const b = busiest(['2026-03-02T20:10:00Z', '2026-03-02T20:50:00Z', '2026-03-03T09:00:00Z'], 0);
    expect(b).toMatchObject({ weekday: 1, hour: 20 });
    expect(busiest([], 0)).toBeNull();
  });

  it('picks first and last moments', () => {
    const r = firstAndLast([{ kind: 'film', title: 'B', at: '2026-06-01T00:00:00Z' }, null, { kind: 'song', title: 'A', at: '2026-01-02T00:00:00Z' }, { kind: 'video', title: 'C', at: '2026-12-30T00:00:00Z' }]);
    expect([r?.first.title, r?.last.title]).toEqual(['A', 'C']);
    expect(firstAndLast([null])).toBeNull();
  });
});

describe('year in review', () => {
  const empty = { plays: 0, minutes: 0, artists: [], songs: [], genres: [], weekdays: Array(7).fill(0), hours: Array(24).fill(0), first: null, last: null };

  it('reports an empty year without zeros to show', () => {
    const r = yearInReview({ year: 2026, tzMin: 0, music: empty, films: [], episodes: [], videos: [] });
    expect(r.empty).toBe(true);
    expect(r.busiest).toBeNull();
    expect(r.binge).toBeNull();
    expect(r.first).toBeNull();
  });

  it('adds hours across music, films, episodes and videos', () => {
    const r = yearInReview({
      year: 2026, tzMin: 0, music: { ...empty, plays: 1, minutes: 120 },
      films: [{ id: 'f', title: 'Film', at: '2026-02-01T20:00:00Z', minutes: 90, rating: 8 }],
      episodes: [ep('a', '2026-03-01T10:00:00Z'), ep('a', '2026-03-01T11:00:00Z')],
      videos: [{ id: 'v', channel: 'Chan', at: '2026-04-01T10:00:00Z', seconds: 3600 }]
    });
    expect(r.hours).toEqual({ listened: 2, watched: 2.8, videos: 1, total: 5.8 });
    expect(r.topShows[0]).toMatchObject({ title: 'Show a', episodes: 2 });
    expect(r.topChannels[0]).toMatchObject({ name: 'Chan', videos: 1 });
    expect(r.binge?.episodes).toBe(2);
    expect(r.empty).toBe(false);
  });
});
