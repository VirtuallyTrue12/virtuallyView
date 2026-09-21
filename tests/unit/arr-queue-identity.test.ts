import { afterEach, describe, expect, it, vi } from 'vitest';
import { RadarrAdapter } from '../../packages/integrations/src/adapters/RadarrAdapter.js';
import { SonarrAdapter } from '../../packages/integrations/src/adapters/SonarrAdapter.js';
import { LidarrAdapter } from '../../packages/integrations/src/adapters/LidarrAdapter.js';

afterEach(() => vi.unstubAllGlobals());
describe('manager queue runtime identity', () => {
  for (const Adapter of [RadarrAdapter, SonarrAdapter, LidarrAdapter]) {
    it(`${Adapter.name} exposes the real downloadId without inventing missing IDs`, async () => {
      const adapter = new Adapter();
      await adapter.connect({ url: 'http://metadata.invalid', apiKey: 'test-only' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [
        { id: 12, downloadId: 'client-hash-123', size: 100, sizeleft: 40 },
        { id: 13, size: 100, sizeleft: 100 }
      ] }))));
      const rows = await adapter.getQueue();
      expect(rows[0]).toMatchObject({ downloadId: 'client-hash-123', sourceClient: adapter.id, progress: 60 });
      expect(rows[1]).not.toHaveProperty('downloadId', '13');
      expect(rows[1]?.downloadId).toBeUndefined();
    });
  }
});
