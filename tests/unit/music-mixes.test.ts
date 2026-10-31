import { describe, expect, it } from 'vitest';
import { buildWeeklyMixes, isoWeekKey, MIX_SIZE, type CatalogTrack, type PlayRecord } from '../../apps/server/src/services/music-mixes';

const NOW = new Date('2026-10-31T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();

/** Tracks t0..t(n-1) for one artist, each with its own cover. */
function artistTracks(artistId: string, n: number, prefix = artistId): CatalogTrack[] {
  return Array.from({ length: n }, (_, i) => ({
    trackId: `${prefix}-${i}`,
    title: `${prefix} song ${i}`,
    artistId,
    artistTitle: artistId.toUpperCase(),
    cover: `https://covers/${artistId}-${i % 6}.jpg`
  }));
}

describe('isoWeekKey', () => {
  it('gives the ISO week, with weeks starting on Monday', () => {
    expect(isoWeekKey(new Date('2026-10-31T12:00:00Z'))).toBe('2026-W44');
    // Monday 29 Dec 2025 is already week 1 of 2026.
    expect(isoWeekKey(new Date('2025-12-29T08:00:00Z'))).toBe('2026-W01');
    // Sunday 28 Dec 2025 still belongs to the last week of 2025.
    expect(isoWeekKey(new Date('2025-12-28T23:00:00Z'))).toBe('2025-W52');
  });
});

describe('weekly mixes', () => {
  const catalog = [...artistTracks('alpha', 40), ...artistTracks('beta', 12), ...artistTracks('gamma', 8)];

  it('makes favourites from the last 60 days, most played first', () => {
    const plays: PlayRecord[] = [
      ...Array.from({ length: 9 }, () => ({ trackId: 'alpha-1', playedAt: daysAgo(3) })),
      ...Array.from({ length: 6 }, (_, i) => ({ trackId: `alpha-${i + 10}`, playedAt: daysAgo(10) }))
    ];
    const mixes = buildWeeklyMixes({ userId: 'u1', now: NOW, plays, catalog });
    const favourites = mixes.find(m => m.id === 'favourites');
    expect(favourites).toBeDefined();
    expect(favourites!.tracks.map(t => t.trackId)).toContain('alpha-1');
    expect(favourites!.tracks.length).toBe(7);
    expect(favourites!.tracks.every(t => ['alpha-1', 'alpha-10', 'alpha-11', 'alpha-12', 'alpha-13', 'alpha-14', 'alpha-15'].includes(t.trackId))).toBe(true);
  });

  it('makes rediscover from old favourites that have not been played in 60 days', () => {
    const plays: PlayRecord[] = [
      // Five old favourites, each played three times a long time ago.
      ...['beta-0', 'beta-1', 'beta-3', 'beta-4', 'beta-5'].flatMap(id => Array.from({ length: 3 }, () => ({ trackId: id, playedAt: daysAgo(200) }))),
      // Played often before, but also recently: not a rediscovery.
      ...Array.from({ length: 5 }, () => ({ trackId: 'beta-2', playedAt: daysAgo(180) })),
      { trackId: 'beta-2', playedAt: daysAgo(2) },
      // Only once: not often enough.
      { trackId: 'beta-6', playedAt: daysAgo(300) }
    ];
    const rediscover = buildWeeklyMixes({ userId: 'u1', now: NOW, plays, catalog }).find(m => m.id === 'rediscover');
    expect(rediscover).toBeDefined();
    const ids = rediscover!.tracks.map(t => t.trackId);
    expect([...ids].sort()).toEqual(['beta-0', 'beta-1', 'beta-3', 'beta-4', 'beta-5']);
    expect(ids).not.toContain('beta-2');
    expect(ids).not.toContain('beta-6');
  });

  it('makes deep cuts from unplayed tracks by the artists you play most', () => {
    const plays: PlayRecord[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ trackId: `gamma-${i % 3}`, playedAt: daysAgo(i) }))
    ];
    const deep = buildWeeklyMixes({ userId: 'u1', now: NOW, plays, catalog }).find(m => m.id === 'deep-cuts');
    expect(deep).toBeDefined();
    expect(deep!.tracks.every(t => t.artistId === 'gamma')).toBe(true);
    expect(deep!.tracks.some(t => ['gamma-0', 'gamma-1', 'gamma-2'].includes(t.trackId))).toBe(false);
    expect(deep!.tracks.length).toBe(5);
  });

  it('caps each mix at about 25 tracks and gives up to four covers', () => {
    const plays: PlayRecord[] = catalog.map((t, i) => ({ trackId: t.trackId, playedAt: daysAgo(i % 50) }));
    const favourites = buildWeeklyMixes({ userId: 'u1', now: NOW, plays, catalog }).find(m => m.id === 'favourites')!;
    expect(favourites.tracks.length).toBe(MIX_SIZE);
    expect(favourites.covers.length).toBe(4);
    expect(new Set(favourites.covers).size).toBe(favourites.covers.length);
  });

  it('is the same for the same user in the same week, and different for another user', () => {
    const plays: PlayRecord[] = catalog.map((t, i) => ({ trackId: t.trackId, playedAt: daysAgo(i % 50) }));
    const a = buildWeeklyMixes({ userId: 'u1', now: NOW, plays, catalog });
    const b = buildWeeklyMixes({ userId: 'u1', now: new Date('2026-10-31T23:00:00Z'), plays, catalog });
    expect(b).toEqual(a);
    const other = buildWeeklyMixes({ userId: 'u2', now: NOW, plays, catalog });
    expect(other.find(m => m.id === 'favourites')!.tracks.map(t => t.trackId))
      .not.toEqual(a.find(m => m.id === 'favourites')!.tracks.map(t => t.trackId));
  });

  it('changes on the next Monday', () => {
    const plays: PlayRecord[] = catalog.map((t, i) => ({ trackId: t.trackId, playedAt: daysAgo(i % 50) }));
    const thisWeek = buildWeeklyMixes({ userId: 'u1', now: NOW, plays, catalog });
    const nextWeek = buildWeeklyMixes({ userId: 'u1', now: new Date('2026-11-02T09:00:00Z'), plays, catalog });
    expect(thisWeek[0]!.week).toBe('2026-W44');
    expect(nextWeek[0]!.week).toBe('2026-W45');
    expect(nextWeek[0]!.tracks.map(t => t.trackId)).not.toEqual(thisWeek[0]!.tracks.map(t => t.trackId));
  });

  it('leaves out a mix with fewer than five tracks, and makes nothing for a new listener', () => {
    expect(buildWeeklyMixes({ userId: 'u1', now: NOW, plays: [], catalog })).toEqual([]);
    const plays: PlayRecord[] = [{ trackId: 'alpha-0', playedAt: daysAgo(1) }];
    const mixes = buildWeeklyMixes({ userId: 'u1', now: NOW, plays, catalog });
    expect(mixes.find(m => m.id === 'favourites')).toBeUndefined();
  });

  it('ignores plays of tracks that are no longer in the library', () => {
    const plays: PlayRecord[] = Array.from({ length: 10 }, (_, i) => ({ trackId: `gone-${i}`, playedAt: daysAgo(1) }));
    expect(buildWeeklyMixes({ userId: 'u1', now: NOW, plays, catalog }).find(m => m.id === 'favourites')).toBeUndefined();
  });
});
