import { describe, test, expect, vi, beforeAll, afterEach } from 'vitest';
import { createRequest, cancelRequest, stopRequest, deleteRequest, getRequests, getRequest, reviewStuckSearches, syncRequestsWithServices } from '../../apps/server/src/services/requests.js';
import { getAdapter } from '../../apps/server/src/services/registry.js';
import type { RadarrAdapter, SonarrAdapter, LidarrAdapter } from '@virtuallyview/integrations';

const downloads = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, removed: [] as string[] }));
vi.mock('../../apps/server/src/services/real-downloads.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../apps/server/src/services/real-downloads.js')>()),
  getDownloads: async () => downloads.rows,
  actOnDownload: async (id: string) => { downloads.removed.push(id); return { success: true, message: 'ok' }; }
}));

const uuid = '33333333-3333-4333-8333-333333333333';
const json = (body: unknown) => new Response(JSON.stringify(body));

// Fixtures for the live-instance endpoints added by the P1-2 fix: quality
// profiles, root folders (and Lidarr metadata profiles) are read from the
// connected service at add time instead of being hardcoded.
const instanceFixture = (url: unknown): Response | null =>
  String(url).includes('/qualityprofile')
    ? json([{ id: 4, name: 'HD-1080p' }])
    : String(url).includes('/rootfolder')
      ? json([{ path: '/media/movies', accessible: true }])
      : String(url).includes('/metadataprofile')
        ? json([{ id: 1, name: 'Standard' }])
        : null;
describe('request pipeline', () => {
  beforeAll(async () => {
    // requests.ts shares the registry's singleton adapters, which are only
    // connected if apps/server/data/integrations.json happens to exist on
    // disk. Connect them explicitly so these tests never depend on that
    // ambient state.
    await getAdapter<RadarrAdapter>('radarr').connect({ url: 'http://test-radarr', apiKey: 'test' });
    await getAdapter<SonarrAdapter>('sonarr').connect({ url: 'http://test-sonarr', apiKey: 'test' });
    await getAdapter<LidarrAdapter>('lidarr').connect({ url: 'http://test-lidarr', apiKey: 'test' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Never let this suite's play requests leak into the real ledger, which
    // other suites (and the running server) read as live state.
    for (const id of getRequests().map(r => r.id)) deleteRequest(id);
  });

  test('rejects a title already in the library instead of creating a duplicate request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => init?.method === 'POST'
      ? json({ id: 42 })
      : json(String(url).includes('/movie/lookup')
        ? [{ tmdbId: 1, title: 'Dune', year: 2021 }]
        // Raw Radarr API shape: tmdbId is top-level; the adapter maps it
        // into provider.metadata, which is what the service matches on.
        : [{ id: 7, title: 'Dune', year: 2021, hasFile: true, tmdbId: 1 }])));
    const result = await createRequest({ title: 'Dune', year: 2021, selectedProviderId: '1' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/already in your library/i);
    expect(getRequests().find(r => r.id === result.request?.id)?.status).toBe('failed');
  });

  test('creating a request calls Radarr for real and reflects a real failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 })); // lookup fails
    vi.stubGlobal('fetch', fetchMock);

    const result = await createRequest({ title: 'Some New Movie' });
    expect(result.ok).toBe(false);
    expect(result.request?.status).toBe('failed');
    expect(result.message).toMatch(/lookup failed/i);
    expect(getRequests().find(r => r.id === result.request?.id)?.status).toBe('failed');
  });

  test('creating a request succeeds and moves to searching when Radarr accepts the selected identity', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const instance = instanceFixture(url);
      if (instance) return instance;
      if (init?.method === 'POST') return json({ id: 42 });
      return json(String(url).includes('/movie/lookup')
        ? [{ tmdbId: 1, title: 'Some New Movie', year: 2021, overview: 'Space travel.' }]
        : [{ id: 7, title: 'Some New Movie', year: 2021, hasFile: false, provider: { metadata: { tmdbId: 1 } } }]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createRequest({ title: 'Some New Movie', year: 2021, selectedProviderId: '1' });
    expect(result.request?.status).toBe('searching');
    expect(result.request?.selectedProviderId).toBe('1');
    // The add must use the profile/folder read from the instance, and the
    // ledger shows them instead of a canned "HD-1080p" label.
    expect(result.request?.qualityProfile).toBe('HD-1080p');
    expect(result.request?.rootFolder).toBe('/media/movies');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(post![1]!.body as string)).toMatchObject({ tmdbId: 1, qualityProfileId: 4, rootFolderPath: '/media/movies' });
  });

  test('a request nobody can find says so after a while and is searched again on its own', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const instance = instanceFixture(url);
      if (instance) return instance;
      if (init?.method === 'POST') return json({ id: 42 });
      return json(String(url).includes('/movie/lookup')
        ? [{ tmdbId: 77, title: 'Nowhere Film', year: 2020, status: 'released' }]
        : []);
    });
    vi.stubGlobal('fetch', fetchMock);
    const made = await createRequest({ title: 'Nowhere Film', year: 2020, selectedProviderId: '77' });
    expect(made.request?.status).toBe('searching');
    const id = made.request!.id;

    // Ten minutes in: still looking, no message yet, no extra search.
    fetchMock.mockClear();
    await reviewStuckSearches(Date.now() + 10 * 60 * 1000);
    expect(getRequest(id)?.message ?? '').not.toMatch(/Nothing found yet/);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/command'))).toBe(false);

    // Forty minutes in: the viewer is told, and the service is asked to search again.
    await reviewStuckSearches(Date.now() + 40 * 60 * 1000);
    expect(getRequest(id)?.message).toMatch(/Nothing found yet/);
    expect(getRequest(id)?.searches).toBe(1);
    expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes('/command') && (i as RequestInit)?.method === 'POST')).toBe(true);

    // Right after that search, no second one: the next is hours away.
    fetchMock.mockClear();
    await reviewStuckSearches(Date.now() + 45 * 60 * 1000);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/command'))).toBe(false);
  });

  test('ambiguous lookup with different provider IDs refuses with candidates instead of posting', async () => {
    const fetchMock = vi.fn(async () => json([
      { tmdbId: 1, title: 'Dune', year: 2021 },
      { tmdbId: 2, title: 'Dune', year: 2021 }
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const result = await createRequest({ title: 'Dune', year: 2021 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('ambiguous');
    expect(result.candidates?.map(c => c.providerId)).toEqual(['1', '2']);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Lookup only, never the add POST.
    expect(getRequests().find(r => r.title === 'Dune')?.status).toBe('failed');
  });

  test('cancelling a non-terminal request marks it cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const instance = instanceFixture(url);
      if (instance) return instance;
      if (init?.method === 'POST') return json({ id: 42 });
      return json([{ tmdbId: 1, title: 'Cancel Me', year: 2021 }]);
    }));
    const created = await createRequest({ title: 'Cancel Me', selectedProviderId: '1' });
    const cancelled = cancelRequest(created.request!.id);
    expect(cancelled?.status).toBe('cancelled');
  });

  test('stopping a request also removes its running downloads, and only its own', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const instance = instanceFixture(url);
      if (instance) return instance;
      if (init?.method === 'POST') return json({ id: 42 });
      return json([{ tmdbId: 1, title: 'Stop Me', year: 2021 }]);
    }));
    const created = await createRequest({ title: 'Stop Me', selectedProviderId: '1' });
    const providerId = created.request!.providerId ?? 'radarr-42';
    downloads.removed = [];
    downloads.rows = [
      { id: 'queue-radarr-1', mediaId: providerId, actions: ['remove'] },
      { id: 'queue-radarr-2', mediaId: 'someone-else', actions: ['remove'] },
      { id: 'queue-radarr-3', mediaId: providerId, actions: [] }
    ];
    const result = await stopRequest(created.request!.id);
    expect(result?.request.status).toBe('cancelled');
    expect(result?.stoppedDownloads).toBe(1);
    expect(downloads.removed).toEqual(['queue-radarr-1']);
    expect(await stopRequest('request-does-not-exist')).toBeNull();
    downloads.rows = [];
  });
  test('a cancelled request is not silently marked available by later sync', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const instance = instanceFixture(url);
      if (instance) return instance;
      if (init?.method === 'POST') return json({ id: 42 });
      return json(String(url).includes('/movie/lookup')
        ? [{ tmdbId: 1, title: 'Dune', year: 2021 }]
        : [{ id: 7, title: 'Dune', year: 2021, hasFile: true, tmdbId: 1 }]);
    }));
    const created = await createRequest({ title: 'Dune', year: 2021, selectedProviderId: '1' });
    cancelRequest(created.request!.id);
    await syncRequestsWithServices();
    expect(getRequests().find(r => r.id === created.request!.id)?.status).toBe('cancelled');
  });

  test('requesting a series routes through Sonarr, not Radarr', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const instance = instanceFixture(url);
      if (instance) return instance;
      if (init?.method === 'POST') return json({ id: 42 });
      return json(String(url).includes('/series/lookup')
        ? [{ tvdbId: 1, title: 'Some New Show', year: 2021 }]
        : []);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createRequest({ title: 'Some New Show', year: 2021, mediaType: 'series', selectedProviderId: '1' });
    expect(result.request?.service).toBe('sonarr');
    expect(result.request?.status).toBe('searching');
    expect(String(fetchMock.mock.calls[0][0])).toContain('test-sonarr');
  });

  test('requesting an artist routes through Lidarr, not Radarr', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const instance = instanceFixture(url);
      if (instance) return instance;
      if (init?.method === 'POST') return json({ id: 5 });
      return json(String(url).includes('/artist/lookup')
        ? [{ foreignArtistId: uuid, artistName: 'Some Artist' }]
        : []);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createRequest({ title: 'Some Artist', mediaType: 'artist', selectedProviderId: uuid });
    expect(result.request?.service).toBe('lidarr');
    expect(result.request?.status).toBe('searching');
    expect(String(fetchMock.mock.calls[0][0])).toContain('test-lidarr');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(post![1]!.body as string)).toMatchObject({
      foreignArtistId: uuid,
      qualityProfileId: 4,
      rootFolderPath: '/media/movies'
    });
  });

  test('a music request with more on the way is not called available, and says how much is here', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      const instance = instanceFixture(url);
      if (instance) return instance;
      if (init?.method === 'POST') return json({ id: 5 });
      return json(String(url).includes('/artist/lookup') ? [{ foreignArtistId: uuid, artistName: 'Some Artist' }] : []);
    }));
    const created = await createRequest({ title: 'Some Artist', mediaType: 'artist', selectedProviderId: uuid });
    const id = created.request!.id;
    const lidarr = getAdapter<LidarrAdapter>('lidarr');
    const artist = { id: 'lidarr-5', title: 'Some Artist', type: 'artist', status: 'available', trackFileCount: 39, totalTrackCount: 107, provider: { metadata: { foreignArtistId: uuid } } };
    const items = vi.spyOn(lidarr, 'getItems').mockResolvedValue([artist] as never);
    const queue = vi.spyOn(lidarr, 'getQueue').mockResolvedValue([
      { mediaId: 'lidarr-5', status: 'downloading', progress: 40 }, { mediaId: 'lidarr-5', status: 'queued', progress: 0 }, { mediaId: 'lidarr-5', status: 'warning', progress: 100, statusMessage: 'x', message: 'x' }
    ] as never);

    await syncRequestsWithServices();
    expect(getRequest(id)?.status).toBe('downloading');
    expect(getRequest(id)?.message).toMatch(/^Partly available: 39 of 107 tracks\./);

    // Nothing left in the queue, still missing tracks: usable, and honest about it.
    queue.mockResolvedValue([] as never);
    await syncRequestsWithServices();
    expect(getRequest(id)?.status).toBe('available');
    expect(getRequest(id)?.message).toMatch(/Partly available: 39 of 107 tracks\..*Search missing albums/);
    expect(getRequest(id)?.progress).toBe(36);

    // Once everything is there, the note goes away.
    items.mockResolvedValue([{ ...artist, trackFileCount: 107 }] as never);
    await syncRequestsWithServices();
    expect(getRequest(id)?.status).toBe('available');
    expect(getRequest(id)?.message).toBeUndefined();
    expect(getRequest(id)?.progress).toBe(100);
    items.mockRestore(); queue.mockRestore();
  });
});
