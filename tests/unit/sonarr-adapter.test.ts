import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonarrAdapter } from '@virtuallyview/integrations';

describe('SonarrAdapter', () => {
  let adapter: SonarrAdapter;
  beforeEach(() => { adapter = new SonarrAdapter(); });
  afterEach(() => vi.unstubAllGlobals());

  test('getItem, getItems and search share one cached fetch of the catalogue, same as Radarr', async () => {
    await adapter.connect({ url: 'http://localhost:8989', apiKey: 'key' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 1, title: 'Severance', statistics: { episodeFileCount: 1 } }, { id: 2, title: 'The Bear', statistics: { episodeFileCount: 1 } }]
    });
    vi.stubGlobal('fetch', fetchMock);

    // resolveStreamable (stream.ts) calls getItem again for every byte range and every HLS segment
    // of a TV playback; without a cache that was a fresh full-catalogue Sonarr call every time.
    expect(await adapter.getItem('sonarr-1')).toMatchObject({ title: 'Severance' });
    expect(await adapter.getItem('sonarr-1')).toMatchObject({ title: 'Severance' });
    expect(await adapter.getItem('sonarr-2')).toMatchObject({ title: 'The Bear' });
    expect(await adapter.getItems()).toHaveLength(2);
    expect(await adapter.search('severance')).toEqual([expect.objectContaining({ title: 'Severance' })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('getEpisodeFile is cached: repeated calls for the same episode make one pair of fetches, not one pair per call', async () => {
    await adapter.connect({ url: 'http://localhost:8989', apiKey: 'key' });
    const fetchMock = vi.fn(async (url: string) => (String(url).includes('/episode/') && !String(url).includes('episodefile')
      ? { ok: true, json: async () => ({ episodeFileId: 9 }) }
      : { ok: true, json: async () => ({ path: '/tv/show/ep1.mkv', size: 123 }) }));
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 5; i++) expect(await adapter.getEpisodeFile('episode-101')).toEqual({ path: '/tv/show/ep1.mkv', size: 123 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
