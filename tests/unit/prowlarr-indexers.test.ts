import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProwlarrAdapter } from '@virtuallyview/integrations';
import { explainIndexerError, isAdultIndexer } from '../../packages/integrations/src/adapters/ProwlarrAdapter';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function adapter() {
  const a = new ProwlarrAdapter();
  await a.connect({ url: 'http://prowlarr:9696', apiKey: 'k' });
  return a;
}

afterEach(() => vi.unstubAllGlobals());

describe('Prowlarr sources', () => {
  it('marks a source Prowlarr is skipping after failures', async () => {
    const later = new Date(Date.now() + 3600_000).toISOString();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/indexerstatus')
      ? json([{ indexerId: 1, disabledTill: later }])
      : json([{ id: 1, name: 'Internet Archive', enable: true }, { id: 2, name: 'Other', enable: true }])));
    const list = await (await adapter()).listIndexers();
    expect(list.find(i => i.id === 1)?.failingUntil).toBe(later);
    expect(list.find(i => i.id === 2)?.failingUntil).toBeUndefined();
  });

  it('getIndexers reads Prowlarr\'s real field name (enable), not enabled', async () => {
    // Prowlarr's IndexerResource serialises this as "enable"; reading "enabled" (which Prowlarr never
    // sends) silently reports every indexer as disabled, even a genuinely running one.
    vi.stubGlobal('fetch', vi.fn(async () => json([{ id: 1, name: 'Internet Archive', enable: true }, { id: 2, name: 'Off', enable: false }])));
    const list = await (await adapter()).getIndexers();
    expect(list.find(i => i.id === 1)?.enabled).toBe(true);
    expect(list.find(i => i.id === 2)?.enabled).toBe(false);
  });

  it('turns a timed-out test into plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? json([{ errorMessage: "Unable to connect to indexer, indexer's server is unavailable. Try again later. Http request timed out" }], 400)
      : json({ id: 1 })));
    const result = await (await adapter()).testIndexer(1);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not answering Prowlarr right now/);
  });

  it('never shows the raw abort message when the test itself cannot finish', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return json({ id: 1 });
    }));
    const result = await (await adapter()).testIndexer(1);
    expect(result.message).not.toMatch(/aborted/);
    expect(result.message).toMatch(/not answering/);
  });
});

describe('release search skips unusually slow sources', () => {
  it('leaves a slow indexer out of the search and names it in skipped', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/indexerstats')) {
        return json({ indexers: [{ indexerId: 1, indexerName: 'Internet Archive', averageResponseTime: 46_000 }, { indexerId: 2, indexerName: 'Fast One', averageResponseTime: 2000 }] });
      }
      if (url.includes('/indexer')) return json([{ id: 1, name: 'Internet Archive', enable: true }, { id: 2, name: 'Fast One', enable: true }]);
      return json([{ guid: 'magnet:?xt=urn:btih:a', title: 'Found It' }]);
    }));
    const result = await (await adapter()).searchReleases('inception');
    expect(result.skipped).toEqual(['Internet Archive']);
    expect(result.releases.map(r => r.guid)).toEqual(['magnet:?xt=urn:btih:a']);
    const searchCall = calls.find(u => u.includes('/search?'));
    expect(searchCall).toContain('indexerIds=2');
    expect(searchCall).not.toContain('indexerIds=1');
  });

  it('searches everyone when there is no history yet, or every indexer is slow', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/indexerstats')) return json({ indexers: [] });
      return json([]);
    }));
    const result = await (await adapter()).searchReleases('inception');
    expect(result.skipped).toEqual([]);
  });
});

describe('adult sources', () => {
  it('recognises adult-only sources by category or name', () => {
    expect(isAdultIndexer('PornRips', '', [6000])).toBe(true);
    expect(isAdultIndexer('OpenSharing', '', [6000, 6010, 100123])).toBe(true);
    expect(isAdultIndexer('E-Hentai', 'Gallery site', [7000])).toBe(true);
  });
  it('does not flag a general source that also has an adult category', () => {
    expect(isAdultIndexer('1337x', 'General torrents', [2000, 5000, 3000, 6000])).toBe(false);
    expect(isAdultIndexer('Nyaa', 'Anime', [5070, 100001])).toBe(false);
    expect(isAdultIndexer('Sussex Radio', '', [3000])).toBe(false);
  });
});

describe('add errors in plain words', () => {
  it('explains the errors people actually hit', () => {
    expect(explainIndexerError('Unable to access 1337x.to, blocked by CloudFlare Protection.')).toMatch(/Cloudflare protection/);
    expect(explainIndexerError("Unable to connect to indexer. This is typically caused by DNS/SSL issues. See: \\u0027https://wiki\\u0027 The SSL connection could not be established, see inner exception.")).toMatch(/secure connection .* cut off/);
    expect(explainIndexerError('Http request timed out')).toMatch(/not answering/);
    expect(explainIndexerError('something new')).toBe('Prowlarr could not add it: something new');
  });
});
