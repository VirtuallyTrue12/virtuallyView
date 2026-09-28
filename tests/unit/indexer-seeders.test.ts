import { afterEach, describe, expect, it, vi } from 'vitest';
import { setMinimumSeeders } from '@virtuallyview/integrations';

const config = { url: 'http://localhost:7878', apiKey: 'key' };

afterEach(() => vi.unstubAllGlobals());

describe('setMinimumSeeders', () => {
  it('updates every torrent indexer missing the target value, leaves usenet indexers and matching ones alone', async () => {
    const indexers = [
      { id: 1, protocol: 'torrent', fields: [{ name: 'minimumSeeders', value: 0 }] },
      { id: 2, protocol: 'torrent', fields: [{ name: 'minimumSeeders', value: 2 }] }, // already at target
      { id: 3, protocol: 'usenet', fields: [{ name: 'minimumSeeders', value: 0 }] }, // wrong protocol
      { id: 4, protocol: 'torrent', fields: [{ name: 'someOtherField', value: 1 }] } // no such field
    ];
    const puts: number[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return { ok: true, json: async () => indexers };
      puts.push(JSON.parse(init.body as string).id);
      return { ok: true };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await setMinimumSeeders(config, 2, '/api/v3');
    // #1 updated; #4 skipped (no such field); #2 (already correct) and #3 (usenet) are silently untouched.
    expect(result).toMatchObject({ success: true, updated: 1, skipped: 1 });
    expect(puts).toEqual([1]);
    // Sanity: the GET went to the right versioned path.
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:7878/api/v3/indexer', expect.anything());
  });

  it('uses /api/v1 for Lidarr instead of /api/v3', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }));
    vi.stubGlobal('fetch', fetchMock);
    await setMinimumSeeders(config, 2, '/api/v1');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:7878/api/v1/indexer', expect.anything());
  });

  it('reports failure instead of throwing when the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const result = await setMinimumSeeders(config, 2, '/api/v3');
    expect(result).toEqual({ success: false, message: 'connect ECONNREFUSED', updated: 0, skipped: 0 });
  });

  it('reports failure on a non-OK list response instead of a blank success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await setMinimumSeeders(config, 2, '/api/v3');
    expect(result).toEqual({ success: false, message: 'Could not list indexers (HTTP 401).', updated: 0, skipped: 0 });
  });
});
