import { describe, expect, it } from 'vitest';
import { collectionParts, whereYouLeftOff } from '../../apps/web/src/lib/details';
import type { EpisodeItem, MediaItem } from '../../apps/web/src/lib/api';

const ep = (s: number, e: number, extra: Partial<EpisodeItem> = {}): EpisodeItem =>
  ({ id: `e${s}${e}`, seriesId: 'x', seasonNumber: s, episodeNumber: e, title: `T${e}`, hasFile: true, runtime: 40, ...extra });

describe('where you left off', () => {
  it('resumes a half-watched episode with minutes left', () => {
    const w = whereYouLeftOff([ep(2, 6), ep(2, 5, { watchProgress: 42 }), ep(2, 4, { watched: true })]);
    expect(w).toMatchObject({ kind: 'resume', minutesLeft: 23 });
    expect(w?.episode.id).toBe('e25');
  });
  it('goes to the episode after the last finished one', () => {
    const w = whereYouLeftOff([ep(1, 1, { watched: true }), ep(1, 2, { watchProgress: 97 }), ep(1, 3), ep(1, 4)]);
    expect(w).toMatchObject({ kind: 'next' });
    expect(w?.episode.id).toBe('e13');
  });
  it('starts at the first playable episode when nothing is watched, or all are', () => {
    expect(whereYouLeftOff([ep(1, 2), ep(1, 1), ep(1, 3, { hasFile: false })])).toMatchObject({ kind: 'start', episode: { id: 'e11' } });
    expect(whereYouLeftOff([ep(1, 1, { watched: true }), ep(1, 2, { watched: true })])).toMatchObject({ kind: 'start', episode: { id: 'e11' } });
  });
  it('says nothing without playable episodes', () => {
    expect(whereYouLeftOff([ep(1, 1, { hasFile: false })])).toBeNull();
  });
});

describe('collection parts', () => {
  const m = (id: string, title: string, year: number, collection?: string): MediaItem => ({ id, title, year, collection } as MediaItem);
  const lib = [m('3', 'C', 2005, 'Saga'), m('1', 'A', 1999, 'Saga'), m('2', 'B', 2002, 'Saga'), m('9', 'Other', 2000, 'Else'), m('8', 'Solo', 2001)];
  it('lists the others oldest first', () => {
    expect(collectionParts(lib[1], lib).map(x => x.id)).toEqual(['2', '3']);
  });
  it('is empty without a collection', () => {
    expect(collectionParts(lib[4], lib)).toEqual([]);
  });
});
