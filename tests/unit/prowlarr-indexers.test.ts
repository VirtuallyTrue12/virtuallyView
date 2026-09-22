import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProwlarrAdapter } from '@virtuallyview/integrations';

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
