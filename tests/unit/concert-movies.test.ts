import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'vv-cm-'));
type Mod = typeof import('../../apps/server/src/services/concert-movies.js');
let cm: Mod;
beforeAll(async () => { cm = await import('../../apps/server/src/services/concert-movies.js'); });

const deps = (library: Array<{ id: number; name: string; path: string }>, known: string[] = []) => {
  const added: string[] = [];
  return { added, deps: { lidarr: {
    listArtistFolders: async () => library,
    lookupCandidates: async (n: string) => known.filter(k => k.toLowerCase().startsWith(n.toLowerCase().slice(0, 4))).map(title => ({ title })),
    addArtistQuietly: async (n: string) => { added.push(n); return { id: 90 + added.length, name: n, path: `/media/music/${n}` }; }
  } } };
};

describe('concerts that arrive as films', () => {
  it('spots a concert by its title or its Music genre, and leaves ordinary films alone', () => {
    expect(cm.looksLikeConcert({ title: 'Linkin Park - Live at Rock am Ring', genres: ['Music'] })).toBe(true);
    expect(cm.looksLikeConcert({ title: 'Pink Floyd: Live at Pompeii' })).toBe(true);
    expect(cm.looksLikeConcert({ title: 'Some Band Farewell', genres: ['Music'] })).toBe(true); // genre alone: checked against artists next
    expect(cm.looksLikeConcert({ title: 'Interstellar', genres: ['Drama', 'Science Fiction'] })).toBe(false);
  });

  it('moves a band\'s concert to the band (creating the band when new) and out of the film lists', async () => {
    const { deps: d, added } = deps([], ['Linkin Park']);
    const films = [
      { id: 'radarr-3', title: 'Linkin Park - Live at Rock am Ring', year: 2004, genres: ['Music'] },
      { id: 'radarr-1', title: 'I Am Legend', year: 2007, genres: ['Drama'] },
      { id: 'radarr-5', title: 'Bohemian Rhapsody', year: 2018, genres: ['Music', 'Drama'] }
    ];
    expect(await cm.sweepConcertMovies(films, d)).toBe(1);
    expect(added).toEqual(['Linkin Park']);
    expect(cm.concertMovieIds().has('radarr-3')).toBe(true);
    expect(cm.withoutConcerts(films).map(f => f.id)).toEqual(['radarr-1', 'radarr-5']);
    expect(cm.concertMoviesOf(91)).toEqual(['radarr-3']);
    // The second look does nothing new, and does not create the band twice.
    expect(await cm.sweepConcertMovies(films, d)).toBe(0);
    expect(added).toHaveLength(1);
  });

  it('files a concert under an artist already in the library, and understands "Artist: Title"', async () => {
    const { deps: d, added } = deps([{ id: 7, name: 'Pink Floyd', path: '/media/music/Pink Floyd' }]);
    await cm.sweepConcertMovies([{ id: 'radarr-9', title: 'Pink Floyd: Live at Pompeii', genres: ['Music'] }], d);
    expect(cm.concertMoviesOf(7)).toEqual(['radarr-9']);
    expect(added).toEqual([]);
  });

  it('title-only mode leaves genre-only films for the background check', async () => {
    const { deps: d } = deps([{ id: 8, name: 'Some Band', path: '/media/music/Some Band' }]);
    expect(await cm.sweepConcertMovies([{ id: 'radarr-11', title: 'Some Band Farewell', genres: ['Music'] }], d, { onlyTitleBased: true })).toBe(0);
    expect(await cm.sweepConcertMovies([{ id: 'radarr-11', title: 'Some Band Farewell', genres: ['Music'] }], d)).toBe(0); // no artist in a plain title: not moved
  });
});
