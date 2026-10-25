import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/server/src/services/registry.js', () => ({
  loadServiceConfig: () => ({
    radarr: { url: 'http://radarr:7878', apiKey: 'r', enabled: true },
    sonarr: { url: 'http://sonarr:8989', apiKey: 's', enabled: true },
    lidarr: { url: 'http://lidarr:8686', apiKey: 'l', enabled: true }
  })
}));

const { retestArrSources } = await import('../../apps/server/src/services/auto-repair.js');

describe('waking search sources after an outage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tests the sources only where every one is resting, and reports the ones that came back', async () => {
    const resting = new Set(['radarr', 'lidarr']);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const service = new URL(url).hostname;
      calls.push(`${init?.method ?? 'GET'} ${service} ${new URL(url).pathname}`);
      if (url.endsWith('/indexer/testall')) { if (service === 'radarr') resting.delete(service); return new Response('[]'); }
      return new Response(JSON.stringify(resting.has(service) ? [{ source: 'IndexerSearchCheck' }] : [{ source: 'AllowedHostsCheck' }]));
    }));
    const revived = await retestArrSources();
    expect(revived).toEqual(['radarr']);
    expect(calls.filter(c => c.startsWith('POST'))).toEqual(['POST radarr /api/v3/indexer/testall', 'POST lidarr /api/v1/indexer/testall']);
  });
});
