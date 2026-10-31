import { describe, expect, it } from 'vitest';
import { yearInReview, type ReviewPlay } from '../../apps/server/src/services/year-review';

const play = (trackId: string, title: string, artist: string, playedAt: string, opts: { genre?: string | null; durationMs?: number } = {}): ReviewPlay => ({
  trackId,
  title,
  artist,
  genre: 'genre' in opts ? opts.genre : 'Rock',
  durationMs: opts.durationMs ?? 180_000,
  playedAt
});

describe('year in review', () => {
  it('only counts the chosen year', () => {
    const review = yearInReview({
      year: 2026,
      plays: [
        play('1', 'Old', 'Ghost', '2025-12-31T23:59:00Z'),
        play('2', 'New', 'Fresh', '2026-01-01T00:00:00Z')
      ],
      films: [{ id: 'm1', title: 'Last Year Film', finishedAt: '2025-06-01T00:00:00Z' }],
      episodes: []
    });
    expect(review.totals.plays).toBe(1);
    expect(review.topArtists.map(a => a.name)).toEqual(['Fresh']);
    expect(review.totals.films).toBe(0);
  });

  it('adds up minutes listened from track lengths', () => {
    const review = yearInReview({
      year: 2026,
      plays: [
        play('1', 'A', 'X', '2026-03-01T10:00:00Z', { durationMs: 200_000 }),
        play('2', 'B', 'X', '2026-03-01T10:05:00Z', { durationMs: 400_000 })
      ],
      films: [],
      episodes: []
    });
    expect(review.minutesListened).toBe(10);
  });

  it('ranks the top five artists and songs, and the top genre', () => {
    const plays: ReviewPlay[] = [
      ...Array.from({ length: 6 }, (_, i) => play('s1', 'Anthem', 'Alpha', `2026-02-0${(i % 9) + 1}T10:00:00Z`, { genre: 'Pop' })),
      ...Array.from({ length: 4 }, (_, i) => play('s2', 'Ballad', 'Beta', `2026-03-0${(i % 9) + 1}T10:00:00Z`, { genre: 'Pop' })),
      ...Array.from({ length: 2 }, () => play('s3', 'Riff', 'Gamma', '2026-04-01T10:00:00Z', { genre: 'Metal' })),
      play('s4', 'Solo', 'Delta', '2026-04-02T10:00:00Z', { genre: 'Metal' }),
      play('s5', 'Lone', 'Epsilon', '2026-04-03T10:00:00Z', { genre: 'Jazz' }),
      play('s6', 'Quiet', 'Zeta', '2026-04-04T10:00:00Z', { genre: 'Jazz' }),
      play('s7', 'Bonus', 'Eta', '2026-04-05T10:00:00Z', { genre: 'Folk' })
    ];
    const review = yearInReview({ year: 2026, plays, films: [], episodes: [] });
    expect(review.topArtists).toHaveLength(5);
    expect(review.topArtists[0]).toEqual({ name: 'Alpha', plays: 6 });
    expect(review.topArtists[1]).toEqual({ name: 'Beta', plays: 4 });
    expect(review.topSongs[0]).toEqual({ title: 'Anthem', artist: 'Alpha', plays: 6 });
    expect(review.topSongs.map(s => s.title)).not.toContain('Bonus');
    expect(review.topGenre).toEqual({ name: 'Pop', plays: 10 });
  });

  it('has no top genre when no play has one', () => {
    const review = yearInReview({ year: 2026, plays: [play('1', 'A', 'B', '2026-01-02T00:00:00Z', { genre: null })], films: [], episodes: [] });
    expect(review.topGenre).toBeNull();
  });

  it('lists up to three films, rated ones first, and the shows with the most episodes', () => {
    const review = yearInReview({
      year: 2026,
      plays: [],
      films: [
        { id: 'f1', title: 'Plain', finishedAt: '2026-01-10T00:00:00Z' },
        { id: 'f2', title: 'Loved', finishedAt: '2026-02-10T00:00:00Z', rating: 9 },
        { id: 'f3', title: 'Liked', finishedAt: '2026-03-10T00:00:00Z', rating: 7 },
        { id: 'f4', title: 'Fine', finishedAt: '2026-04-10T00:00:00Z', rating: 6 }
      ],
      episodes: [
        ...Array.from({ length: 5 }, (_, i) => ({ seriesId: 's1', seriesTitle: 'Long Show', finishedAt: `2026-05-0${i + 1}T00:00:00Z` })),
        ...Array.from({ length: 2 }, (_, i) => ({ seriesId: 's2', seriesTitle: 'Short Show', finishedAt: `2026-06-0${i + 1}T00:00:00Z` })),
        { seriesId: 's3', seriesTitle: 'Pilot Only', finishedAt: '2026-07-01T00:00:00Z' },
        { seriesId: 's4', seriesTitle: 'Another', finishedAt: '2026-07-02T00:00:00Z' }
      ]
    });
    expect(review.topFilms.map(f => f.title)).toEqual(['Loved', 'Liked', 'Fine']);
    expect(review.topShows[0]).toEqual({ title: 'Long Show', episodes: 5 });
    expect(review.topShows[1]).toEqual({ title: 'Short Show', episodes: 2 });
    expect(review.topShows).toHaveLength(3);
    expect(review.totals).toEqual({ plays: 0, films: 4, episodes: 9 });
  });

  it('gives the first play of the year', () => {
    const review = yearInReview({
      year: 2026,
      plays: [
        play('2', 'Later', 'B', '2026-08-01T10:00:00Z'),
        play('1', 'Opener', 'A', '2026-01-03T08:30:00Z')
      ],
      films: [],
      episodes: []
    });
    expect(review.firstPlay).toEqual({ title: 'Opener', artist: 'A', playedAt: '2026-01-03T08:30:00Z' });
  });

  it('is empty but valid for a year with nothing in it', () => {
    const review = yearInReview({ year: 2019, plays: [], films: [], episodes: [] });
    expect(review).toEqual({
      year: 2019,
      totals: { plays: 0, films: 0, episodes: 0 },
      minutesListened: 0,
      topArtists: [],
      topSongs: [],
      topGenre: null,
      topFilms: [],
      topShows: [],
      firstPlay: null
    });
  });
});
