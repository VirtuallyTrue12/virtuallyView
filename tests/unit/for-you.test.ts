import { describe, expect, it } from 'vitest';
import { mixForYou, type ForYouItem, type ForYouKind } from '../../apps/server/src/services/for-you-mix.js';

const items = (kind: ForYouKind, n: number): ForYouItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${kind}-${i}`, kind, reason: `reason ${kind}` }));

describe('For you mixing', () => {
  it('deals the kinds out in turn so none runs the rail', () => {
    const mixed = mixForYou({ movie: items('movie', 12), series: items('series', 3), artist: items('artist', 3), video: items('video', 3) }, { kid: false });
    expect(mixed.slice(0, 4).map(i => i.kind)).toEqual(['movie', 'series', 'artist', 'video']);
    expect(mixed).toHaveLength(19); // 10 movies (the cap) + 3 + 3 + 3
    expect(mixed.filter(i => i.kind === 'movie').length).toBeLessThanOrEqual(10);
  });

  it('shows one kind alone, up to half the rail, and nothing without history', () => {
    expect(mixForYou({ movie: items('movie', 30) }, { kid: false })).toHaveLength(10);
    expect(mixForYou({}, { kid: false })).toEqual([]);
  });

  it('lists a repeated id once', () => {
    const dup = [{ id: 'x', kind: 'movie' as const, reason: 'a' }, { id: 'x', kind: 'movie' as const, reason: 'b' }];
    expect(mixForYou({ movie: dup }, { kid: false })).toHaveLength(1);
  });

  it('keeps music and videos away from a kids profile', () => {
    const mixed = mixForYou({ movie: items('movie', 2), artist: items('artist', 2), video: items('video', 2) }, { kid: true });
    expect(mixed.map(i => i.kind)).toEqual(['movie', 'movie']);
  });
});
