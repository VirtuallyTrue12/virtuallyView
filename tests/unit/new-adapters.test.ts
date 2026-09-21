import { describe, test, expect } from 'vitest';
import { LidarrAdapter, BazarrAdapter, QBittorrentAdapter } from '@virtuallyview/integrations';
import { getManagedAdapters } from '../../apps/server/src/services/registry.js';

describe('new integration adapters', () => {
  test('Lidarr throws instead of returning fake data when not connected', async () => {
    const adapter = new LidarrAdapter();
    await expect(adapter.getItems()).rejects.toThrow(/not connected/i);
  });

  test('Bazarr throws instead of returning fake data when not connected', async () => {
    const adapter = new BazarrAdapter();
    await expect(adapter.getMissingSubtitles()).rejects.toThrow(/not connected/i);
  });

  test('qBittorrent requires username:password shaped credentials', async () => {
    const adapter = new QBittorrentAdapter();
    await adapter.connect({ url: 'http://localhost:8080', apiKey: 'not-valid' });
    await expect(adapter.getQueue()).rejects.toThrow(/username:password/i);
  });

  test('all new adapters are wired into the shared registry', () => {
    const adapters = getManagedAdapters();
    expect(adapters.lidarr).toBeInstanceOf(LidarrAdapter);
    expect(adapters.bazarr).toBeInstanceOf(BazarrAdapter);
    expect(adapters.qbittorrent).toBeInstanceOf(QBittorrentAdapter);
  });
});
