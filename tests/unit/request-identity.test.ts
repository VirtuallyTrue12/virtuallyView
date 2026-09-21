import { describe, test, expect, vi, afterEach } from 'vitest';
import { RadarrAdapter } from '../../packages/integrations/src/adapters/RadarrAdapter.js';
import { SonarrAdapter } from '../../packages/integrations/src/adapters/SonarrAdapter.js';
import { LidarrAdapter } from '../../packages/integrations/src/adapters/LidarrAdapter.js';
import { joinApiUrl, resolveAddTargets } from '../../packages/integrations/src/request-identity.js';

const uuid1 = '11111111-1111-4111-8111-111111111111';
const uuid2 = '22222222-2222-4222-8222-222222222222';
const variants = [
  { Ctor: RadarrAdapter, type: 'movie', row: (id: number, title: string, year?: number) => ({ tmdbId: id, title, year }), id: '2', field: 'tmdbId', value: 2 },
  { Ctor: SonarrAdapter, type: 'series', row: (id: number, title: string, year?: number) => ({ tvdbId: id, title, year }), id: '2', field: 'tvdbId', value: 2 },
  { Ctor: LidarrAdapter, type: 'artist', row: (id: number, title: string, year?: number) => ({ foreignArtistId: id === 1 ? uuid1 : uuid2, artistName: title, year }), id: uuid2, field: 'foreignArtistId', value: uuid2 }
];
const json = (body: unknown) => new Response(JSON.stringify(body));
afterEach(() => vi.unstubAllGlobals());

describe.each(variants)('$Ctor.name request identity', ({ Ctor, type, row, id, field, value }) => {
  async function setup(rows: unknown[]) {
    const adapter = new Ctor();
    await adapter.connect({ url: 'http://metadata.invalid', apiKey: 'test-only' });
    // add() also reads live quality profiles + root folders (P1-2); route by
    // URL so those endpoints return real-looking config instead of lookup rows.
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === 'POST') return json({ id: 42 });
      if (path.includes('/qualityprofile')) return json([{ id: 4, name: 'HD-1080p' }]);
      if (path.includes('/rootfolder')) return json([{ path: '/data/media', accessible: true }]);
      if (path.includes('/metadataprofile')) return json([{ id: 1, name: 'Standard' }]);
      return json(rows); // metadata lookup
    });
    vi.stubGlobal('fetch', fetchMock);
    return { adapter, fetchMock };
  }
  // lookup + qualityprofile + rootfolder (+ metadataprofile for Lidarr) + POST
  const addCalls = (serviceType: string) => (serviceType === 'artist' ? 5 : 4);
  test('lookup is read-only and returns real provider ID/title/year/type', async () => {
    const { adapter, fetchMock } = await setup([row(2, '東京', 2021)]);
    expect(await adapter.lookupCandidates('東京')).toMatchObject([{ providerId: id, title: '東京', year: 2021, type }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('lookup?term=');
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
  });
  test.each([undefined, 2021])('refuses same-title different IDs even with year %s', async year => {
    const { adapter, fetchMock } = await setup([row(1, 'Same', 2021), row(2, 'Same', 2021)]);
    const result = await adapter.add({ title: 'Same', type, year });
    expect(result).toMatchObject({ success: false, code: 'ambiguous' });
    expect(result.candidates).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1); // No POST/command.
  });
  test('selected identity, not first candidate, is posted', async () => {
    const { adapter, fetchMock } = await setup([row(1, 'Same', 2021), row(2, 'Same', 2021)]);
    expect(await adapter.add({ title: 'Same', year: 2021, type, selectedProviderId: id })).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(addCalls(type));
    const post = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ [field]: value });
    expect(post[1]?.method).toBe('POST');
  });
  test.each([
    { title: 'Other', year: 2021 }, { title: 'Same', year: 1984 }, { title: 'Same', year: 2021, selectedProviderId: 'unknown' }
  ])('no fallback for invalid selection/title/year %j', async req => {
    const { adapter, fetchMock } = await setup([row(2, 'Same', 2021)]);
    expect((await adapter.add({ ...req, type })).success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test('different non-Latin names do not normalize to empty', async () => {
    const { adapter, fetchMock } = await setup([row(1, '北京')]);
    expect((await adapter.add({ title: '東京', type })).success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test('preserves distinguishing punctuation and accents', async () => {
    const { adapter, fetchMock } = await setup([row(1, 'P!nk'), row(2, 'Café')]);
    expect((await adapter.add({ title: 'Pnk', type })).success).toBe(false);
    expect((await adapter.add({ title: 'Cafe', type })).success).toBe(false);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  test('single confident case-insensitive match preserves Unicode and punctuation', async () => {
    const { adapter, fetchMock } = await setup([row(2, 'P!nk 東京')]);
    expect((await adapter.add({ title: 'p!nk 東京', type })).success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(addCalls(type));
    const post = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ [field]: value });
  });
  test('lookup exceptions do not post or claim success', async () => {
    const { adapter, fetchMock } = await setup([]);
    fetchMock.mockRejectedValue(new Error('metadata offline'));
    expect(await adapter.add({ title: 'Same', type })).toMatchObject({ success: false, message: 'metadata offline' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('joinApiUrl', () => {
  test('joins a bare base and leading-slash segments with exactly one slash', () => {
    expect(joinApiUrl('http://radarr:7878', '/api/v3', 'qualityprofile')).toBe('http://radarr:7878/api/v3/qualityprofile');
    expect(joinApiUrl('http://lidarr:8686', '/api/v1', 'rootfolder')).toBe('http://lidarr:8686/api/v1/rootfolder');
  });
  test('strips trailing and duplicate slashes from base and segments', () => {
    expect(joinApiUrl('http://sonarr:8989/', '/api/v3/', '/series/lookup/')).toBe('http://sonarr:8989/api/v3/series/lookup');
    expect(joinApiUrl('http://radarr:7878//')).toBe('http://radarr:7878');
  });
});

describe('resolveAddTargets HTML handling', () => {
  afterEach(() => vi.unstubAllGlobals());
  test('single-slash URLs are used for quality profiles and root folders', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith('/qualityprofile')) return new Response(JSON.stringify([{ id: 4, name: 'HD-1080p' }]), { headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify([{ path: '/data/media', accessible: true }]), { headers: { 'content-type': 'application/json' } });
    }));
    const targets = await resolveAddTargets({ url: 'http://radarr:7878', apiKey: 'k' }, 'radarr');
    expect(targets.qualityProfileId).toBe(4);
    expect(targets.rootFolderPath).toBe('/data/media');
    expect(calls).toEqual([
      'http://radarr:7878/api/v3/qualityprofile',
      'http://radarr:7878/api/v3/rootfolder'
    ]);
    expect(calls.every(u => !u.includes('//api'))).toBe(true);
  });
  test('an HTML index page surfaces a readable message instead of a JSON parse error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html>Radarr</html>', { headers: { 'content-type': 'text/html' } })));
    await expect(resolveAddTargets({ url: 'http://radarr:7878', apiKey: 'k' }, 'radarr'))
      .rejects
      .toThrow(/HTML page instead of JSON/);
  });
});
