import { describe, expect, it } from 'vitest';
import { queueByItem } from '../../apps/server/src/services/item-downloads.js';

describe('per-item downloads', () => {
  it('maps queue rows to episodes and keeps the most active row', async () => {
    const map = await queueByItem('sonarr', {
      getQueue: async () => [
        { status: 'paused', progress: 10, episodeId: 7 },
        { status: 'downloading', progress: 42.4, timeleft: '00:10:00', episodeId: 7 },
        { status: 'queued', progress: 0, episodeId: 8 },
        { status: 'downloading', progress: 5 }
      ]
    });
    expect(map.size).toBe(2);
    expect(map.get(7)).toEqual({ progress: 42, status: 'downloading', timeleft: '00:10:00' });
    expect(map.get(8)?.status).toBe('queued');
  });

  it('maps music rows by album', async () => {
    const map = await queueByItem('lidarr', { getQueue: async () => [{ status: 'downloading', progress: 80, albumId: 3 }] });
    expect(map.get(3)?.progress).toBe(80);
  });

  it('shows nothing when the media app cannot be reached', async () => {
    const map = await queueByItem('sonarr', { getQueue: async () => { throw new Error('down'); } });
    expect(map.size).toBe(0);
  });
});
