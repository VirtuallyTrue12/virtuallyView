import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { RadarrAdapter } from '@virtuallyview/integrations';

describe('RadarrAdapter', () => {
  let adapter: RadarrAdapter;

  beforeEach(() => {
    adapter = new RadarrAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('throws instead of returning fake data when not connected', async () => {
    await expect(adapter.getItems()).rejects.toThrow(/not connected/i);
    await expect(adapter.search('anything')).rejects.toThrow(/not connected/i);
    await expect(adapter.add({ title: 'x', type: 'movie' })).rejects.toThrow(/not connected/i);
  });

  test('healthCheck reports offline without config', async () => {
    const health = await adapter.healthCheck();
    expect(health).toEqual({ healthy: false, status: 'offline' });
  });

  test('add() propagates a real lookup failure instead of reporting fake success', async () => {
    await adapter.connect({ url: 'http://localhost:7878', apiKey: 'key' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })
    );
    const result = await adapter.add({ title: 'Interstellar', type: 'movie' });
    expect(result.success).toBe(false);
    // The message must identify the failed lookup; nothing is added.
    expect(result.message).toMatch(/lookup failed.*500|status 500/i);
  });

  test('add() with an ambiguous lookup never posts and reports no success', async () => {
    await adapter.connect({ url: 'http://localhost:7878', apiKey: 'key' });
    const rows = [
      { tmdbId: 1, title: 'Interstellar', year: 2014 },
      { tmdbId: 2, title: 'Interstellar', year: 2020 }
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(rows),
      json: async () => rows
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await adapter.add({ title: 'Interstellar', type: 'movie' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('ambiguous');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('add() succeeds and reports the real Radarr response', async () => {
    await adapter.connect({ url: 'http://localhost:7878', apiKey: 'key' });
    // Regression guard: the quality profile id and root folder must come from
    // the connected instance (qualityprofile/rootfolder calls), never from
    // hardcoded values - add() would fail if they were guessed.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([{ tmdbId: 157336, title: 'Interstellar', year: 2014 }]),
        json: async () => [{ tmdbId: 157336, title: 'Interstellar', year: 2014 }]
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([{ id: 4, name: 'HD-1080p' }]),
        json: async () => [{ id: 4, name: 'HD-1080p' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([{ path: '/data/media/movies', accessible: true }]),
        json: async () => [{ path: '/data/media/movies', accessible: true }]
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.add({ title: 'Interstellar', type: 'movie' });
    expect(result.success).toBe(true);
    expect(result.qualityProfile).toBe('HD-1080p');
    expect(result.rootFolder).toBe('/data/media/movies');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/qualityprofile');
    expect(String(fetchMock.mock.calls[2][0])).toContain('/rootfolder');
    const post = fetchMock.mock.calls[3];
    expect(String(post[0])).toContain('/api/v3/movie');
    expect(post[1]?.method).toBe('POST');
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      tmdbId: 157336,
      qualityProfileId: 4,
      rootFolderPath: '/data/media/movies'
    });
  });

  test('add() fails when the instance has no usable quality profile or root folder', async () => {
    await adapter.connect({ url: 'http://localhost:7878', apiKey: 'key' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([{ tmdbId: 157336, title: 'Interstellar', year: 2014 }]),
        json: async () => [{ tmdbId: 157336, title: 'Interstellar', year: 2014 }]
      })
      .mockResolvedValueOnce({ ok: true, text: async () => '[]', json: async () => [] })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify([{ path: '/media/movies', accessible: true }]), json: async () => [{ path: '/media/movies', accessible: true }] });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.add({ title: 'Interstellar', type: 'movie' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/quality profile/i);
    // Nothing was posted to the movie endpoint when configuration was missing.
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(0);
  });

  test('status reflects hasFile, not Radarr\'s isAvailable (release-date) flag', async () => {
    // Regression: isAvailable means "past its release/minimum-availability
    // window", not "currently downloading" - a released movie with no file
    // yet must show as "missing", never "importing".
    await adapter.connect({ url: 'http://localhost:7878', apiKey: 'key' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: 1, title: 'Released, no file', hasFile: false, isAvailable: true },
          { id: 2, title: 'Has file', hasFile: true, isAvailable: true }
        ]
      })
    );
    const items = await adapter.getItems();
    expect(items[0].status).toBe('missing');
    expect(items[1].status).toBe('available');
  });

  test('remove() calls the real DELETE endpoint', async () => {
    await adapter.connect({ url: 'http://localhost:7878', apiKey: 'key' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.remove('radarr-42');
    expect(result.success).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v3/movie/42');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
