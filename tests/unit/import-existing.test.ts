import { describe, expect, it, vi } from 'vitest';
import { findUnmapped, folderTerm, importFolders, pickBest } from '../../apps/server/src/services/import-existing.js';

describe('finding existing media', () => {
  it('turns a folder name into a search term and a year', () => {
    expect(folderTerm('How I Met Your Mother')).toEqual({ term: 'How I Met Your Mother' });
    expect(folderTerm('Dune (2021)')).toEqual({ term: 'Dune', year: 2021 });
    expect(folderTerm('The.Office.US.2005.1080p.BluRay.x265')).toEqual({ term: 'The Office US', year: 2005 });
    expect(folderTerm('Pink_Floyd [FLAC]')).toEqual({ term: 'Pink Floyd' });
    expect(folderTerm('Breaking Bad Season 3').term).toBe('Breaking Bad');
  });

  it('is sure only when the title (and year) clearly match', () => {
    const c = (title: string, year?: number) => ({ provider: 'tmdb', providerId: title, title, ...(year ? { year } : {}) });
    expect(pickBest('Dune', 2021, [c('Dune', 1984), c('Dune', 2021)])?.year).toBe(2021);
    expect(pickBest('the office', undefined, [c('The Office', 2005)])?.title).toBe('The Office');
    expect(pickBest('Dune', 2021, [c('Dune: Part Two', 2024)])).toBeNull();
    expect(pickBest('Dune', 1999, [c('Dune', 1984), c('Dune', 2021)])).toBeNull();
  });

  it('lists what is waiting, and imports only folders the media app really lists', async () => {
    const add = vi.fn(async () => ({ success: true, message: 'ok' }));
    const adapter = {
      unmappedFolders: async () => [{ name: 'Dune (2021)', path: '/media/movies/Dune (2021)' }, { name: 'Mystery', path: '/media/movies/Mystery' }],
      lookupCandidates: async (t: string) => (t === 'Dune' ? [{ provider: 'tmdb', providerId: '438631', title: 'Dune', year: 2021 }] : []),
      add
    };
    const found = await findUnmapped('movies', adapter);
    expect(found.map(f => [f.folder, f.best?.providerId ?? null])).toEqual([['Dune (2021)', '438631'], ['Mystery', null]]);

    const results = await importFolders('movies', [
      { path: '/media/movies/Dune (2021)', providerId: '438631', title: 'Dune', year: 2021 },
      { path: '/etc', providerId: '1', title: 'Made up' }
    ], adapter);
    expect(results.map(r => r.success)).toEqual([true, false]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({ title: 'Dune', type: 'movie', year: 2021, selectedProviderId: '438631', existingPath: '/media/movies/Dune (2021)' });
  });
});
