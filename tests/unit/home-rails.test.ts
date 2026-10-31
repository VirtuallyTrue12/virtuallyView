import { describe, expect, it } from 'vitest';
import {
  applyHomeLayout, pickAnchors, similarTitles, topHousehold, type TasteSignals
} from '../../apps/server/src/services/home-rails.js';

const none = (): TasteSignals => ({ finished: new Set(), thumbsDown: new Set(), thumbsUp: new Set() });

const title = (id: string, genres: string[], collection?: string) => ({ id, genres, collection });

describe('because you watched: similar titles', () => {
  const anchor = title('radarr-1', ['Sci-Fi', 'Thriller'], 'Mars Saga');
  const library = [
    anchor,
    title('radarr-2', ['Sci-Fi', 'Thriller']),             // same genres: 4
    title('radarr-3', ['Sci-Fi']),                         // one of two genres: 2
    title('radarr-4', ['Romance']),                        // nothing in common: left out
    title('radarr-5', ['Sci-Fi'], 'Mars Saga'),            // one genre (2) plus the same collection (2): 4
    title('sonarr-6', ['Sci-Fi', 'Thriller'])              // same genres, a show: 4
  ];

  it('ranks by genre overlap, with a shared collection adding to the score', () => {
    const ranked = similarTitles(anchor, library, none());
    expect(ranked.map(s => [s.item.id, s.score])).toEqual([['radarr-2', 4], ['radarr-5', 4], ['sonarr-6', 4], ['radarr-3', 2]]);
  });

  it('never returns the anchor, anything finished, or anything thumbed down', () => {
    const signals: TasteSignals = { finished: new Set(['radarr-2']), thumbsDown: new Set(['radarr-5']), thumbsUp: new Set() };
    const ids = similarTitles(anchor, library, signals).map(s => s.item.id);
    expect(ids).toEqual(['sonarr-6', 'radarr-3']);
  });

  it('boosts a title the viewer thumbed up', () => {
    const plain = similarTitles(anchor, library, none()).find(s => s.item.id === 'radarr-3')!.score;
    const liked = similarTitles(anchor, library, { ...none(), thumbsUp: new Set(['radarr-3']) }).find(s => s.item.id === 'radarr-3')!.score;
    expect(liked).toBeGreaterThan(plain);
  });

  it('boosts a title that shares genres with titles the viewer thumbed up', () => {
    const lib = [
      anchor,
      title('radarr-10', ['Sci-Fi', 'Horror']),
      title('liked-a', ['Horror']),
      title('liked-b', ['Horror'])
    ];
    const plain = similarTitles(anchor, lib, none()).find(s => s.item.id === 'radarr-10')!.score;
    const boosted = similarTitles(anchor, lib, { ...none(), thumbsUp: new Set(['liked-a', 'liked-b']) })
      .find(s => s.item.id === 'radarr-10')!.score;
    expect(boosted).toBeGreaterThan(plain);
  });

  it('respects the limit and gives nothing back for a title with no overlap at all', () => {
    expect(similarTitles(anchor, library, none(), 2)).toHaveLength(2);
    expect(similarTitles(title('x', ['Opera']), library, none())).toEqual([]);
  });
});

describe('because you watched: picking the anchors', () => {
  const inLibrary = new Set(['radarr-1', 'radarr-2', 'sonarr-3', 'radarr-4']);

  it('takes the most recent distinct titles, newest first', () => {
    const picked = pickAnchors([
      { id: 'radarr-1', at: '2026-10-20T10:00:00.000Z' },
      { id: 'sonarr-3', at: '2026-10-30T10:00:00.000Z' },
      { id: 'radarr-1', at: '2026-10-29T10:00:00.000Z' },
      { id: 'radarr-2', at: '2026-10-25T10:00:00.000Z' }
    ], new Set(), inLibrary);
    expect(picked).toEqual(['sonarr-3', 'radarr-1']);
  });

  it('skips thumbed-down titles and titles no longer in the library', () => {
    const picked = pickAnchors([
      { id: 'radarr-9', at: '2026-10-31T00:00:00.000Z' },
      { id: 'radarr-4', at: '2026-10-30T00:00:00.000Z' },
      { id: 'radarr-2', at: '2026-10-29T00:00:00.000Z' }
    ], new Set(['radarr-4']), inLibrary);
    expect(picked).toEqual(['radarr-2']);
  });
});

describe('top 10 in your home: counting the household', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  const day = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  it('counts each viewer once per title, most viewers first', () => {
    const rows = [
      { userId: 'ana', id: 'radarr-1', at: day(1) },
      { userId: 'ben', id: 'radarr-1', at: day(2) },
      { userId: 'ana', id: 'radarr-1', at: day(3) },    // same viewer again: still one
      { userId: 'ana', id: 'sonarr-2', at: day(0.5) },
      { userId: 'ana', id: 'radarr-3', at: day(0.1) }
    ];
    const top = topHousehold(rows, now);
    expect(top.map(t => [t.id, t.viewers])).toEqual([['radarr-1', 2], ['radarr-3', 1], ['sonarr-2', 1]]);
  });

  it('ignores anything older than the window', () => {
    const rows = [
      { userId: 'ana', id: 'old-hit', at: day(8) },
      { userId: 'ben', id: 'old-hit', at: day(9) },
      { userId: 'ana', id: 'fresh', at: day(6.9) }
    ];
    expect(topHousehold(rows, now).map(t => t.id)).toEqual(['fresh']);
  });

  it('caps the list at the limit', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ userId: 'ana', id: `radarr-${i}`, at: day(1) }));
    expect(topHousehold(rows, now)).toHaveLength(10);
    expect(topHousehold(rows, now, 7, 3)).toHaveLength(3);
  });
});

describe('home layout: order and hidden rails', () => {
  const rails = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('applies a saved order and hides the rails marked hidden', () => {
    const out = applyHomeLayout(rails, [
      { railId: 'c', hidden: false, position: 0 },
      { railId: 'a', hidden: true, position: 1 },
      { railId: 'b', hidden: false, position: 2 }
    ]);
    expect(out.map(r => [r.id, r.hidden])).toEqual([['c', false], ['a', true], ['b', false], ['d', false]]);
  });

  it('keeps the default order for rails without a saved position', () => {
    const out = applyHomeLayout(rails, [{ railId: 'd', hidden: false, position: 0 }]).map(r => r.id);
    // Unsaved rails keep their default order among themselves; d's saved slot 0 ties with a's default slot, and a wins the tie.
    expect(out.indexOf('a')).toBeLessThan(out.indexOf('b'));
    expect(out.indexOf('b')).toBeLessThan(out.indexOf('c'));
    expect(out[0]).toBe('a');
    expect(out).toContain('d');
  });

  it('returns the defaults untouched when nothing is saved', () => {
    const out = applyHomeLayout(rails, []);
    expect(out.map(r => [r.id, r.hidden])).toEqual([['a', false], ['b', false], ['c', false], ['d', false]]);
  });
});
