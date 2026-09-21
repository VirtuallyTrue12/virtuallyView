import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import Fastify from 'fastify';
const upstream = vi.hoisted(() => Object.fromEntries(['radarr', 'sonarr', 'lidarr', 'qbittorrent', 'nzbget'].map(key => [key, {
  getQueue: vi.fn(), removeQueueItem: vi.fn(), remove: vi.fn(), pause: vi.fn(), resume: vi.fn()
}])));
vi.mock('../../apps/server/src/services/registry.js', () => ({ getAdapter: (key: string) => upstream[key] }));
import downloadsRoutes from '../../apps/server/src/routes/downloads.js';
import { pauseDownload, removeDownload } from '../../apps/server/src/services/real-downloads.js';
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.resetAllMocks();
  for (const adapter of Object.values(upstream)) {
    adapter.getQueue.mockResolvedValue([]);
    for (const action of ['removeQueueItem', 'remove', 'pause', 'resume'] as const) adapter[action].mockResolvedValue({ success: true, message: 'Accepted' });
  }
  app = Fastify();
  await app.register(downloadsRoutes);
  // The artwork fallback (P2-13) probes TMDB/web-cover services for titles the
  // library lookup cannot match; in contract tests those calls must never hit
  // the real network, so fetch is stubbed to fail fast and deterministically.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in unit test')));
});
afterEach(async () => { await app.close(); vi.unstubAllGlobals(); });
describe('real download HTTP contract', () => {
  test.each(['radarr', 'sonarr', 'lidarr'])('%s retains normalized progress, identity and source', async source => {
    upstream[source].getQueue.mockResolvedValue([{ id: 'queue-17', sourceClient: source, title: 'Fixture', status: 'downloading', progress: 63, mediaId: `${source}-2`, timeleft: '00:10:00', size: 1024 ** 3 }]);
    const response = await app.inject('/api/downloads');
    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({ id: `queue-${source}-17`, progress: 63, mediaId: `${source}-2`, sourceClient: source, eta: '00:10:00', size: '1.0 GB' });
  });
  test('one transfer reported by Radarr and qBittorrent becomes one actionable row', async () => {
    const hash = 'ab'.repeat(20);
    upstream.radarr.getQueue.mockResolvedValue([{ id: 'queue-17', downloadId: hash.toUpperCase(), mediaId: 'radarr-3', title: 'Manager title', status: 'downloading', progress: 40 }]);
    upstream.qbittorrent.getQueue.mockResolvedValue([{ id: hash, title: 'Client release', status: 'downloading', progress: 42, speed: 1048576 }]);
    const rows = (await app.inject('/api/downloads')).json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: `queue-qbittorrent-${hash}`, progress: 42, mediaId: 'radarr-3', mediaType: 'movie', reportedBy: ['qbittorrent', 'radarr'], actions: ['pause', 'resume', 'remove', 'delete-files'] });
    await app.inject({ method: 'POST', url: `/api/downloads/${rows[0].id}/pause` });
    expect(upstream.qbittorrent.pause).toHaveBeenCalledWith(hash);
    expect(upstream.radarr.pause).not.toHaveBeenCalled();
  });
  test('artwork fallback resolves provider art for a title missing from the library', async () => {
    const poster = 'https://image.tmdb.org/t/p/w500/abc123.jpg';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html><meta property="og:image" content="https://media.themoviedb.org/t/p/w500/abc123.jpg">ok</html>', { status: 200 })
    ));
    upstream.qbittorrent.getQueue.mockResolvedValue([{ id: 'unmatched-hash', title: 'Not in Library', status: 'downloading', progress: 30 }]);
    const rows = (await app.inject('/api/downloads')).json();
    expect(rows).toHaveLength(1);
    expect(rows[0].artwork?.poster).toBe(poster);
  });
  test('artwork fallback keeps the row intact when the provider lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('provider unreachable')));
    upstream.qbittorrent.getQueue.mockResolvedValue([{ id: 'unmatched-hash-2', title: 'Also Not in Library', status: 'downloading', progress: 10 }]);
    const rows = (await app.inject('/api/downloads')).json();
    expect(rows).toHaveLength(1);
    expect(rows[0].artwork).toBeUndefined();
    expect(rows[0].title).toBe('Also Not in Library');
  });
  test('same title without the same transfer identity never merges unrelated downloads', async () => {
    upstream.radarr.getQueue.mockResolvedValue([{ id: 'queue-17', title: 'Same title', status: 'downloading' }]);
    upstream.qbittorrent.getQueue.mockResolvedValue([{ id: 'ab'.repeat(20), title: 'Same title', status: 'downloading' }]);
    expect((await app.inject('/api/downloads')).json()).toHaveLength(2);
  });
  test('manager entry is retained when its client is unavailable', async () => {
    upstream.radarr.getQueue.mockResolvedValue([{ id: 'queue-17', downloadId: 'ab'.repeat(20), status: 'downloading' }]);
    upstream.qbittorrent.getQueue.mockRejectedValue(new Error('offline'));
    expect((await app.inject('/api/downloads')).json()[0].id).toBe('queue-radarr-17');
  });
  test('removal sends raw upstream ID, not a double-prefixed ID', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/downloads/queue-radarr-17/remove' });
    expect(response.statusCode).toBe(200);
    expect(upstream.radarr.removeQueueItem).toHaveBeenCalledWith('17');
  });
  test('client pause returns an action result, not an incomplete download row', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/downloads/queue-qbittorrent-aabb/pause' });
    expect(response.json()).toEqual({ id: 'queue-qbittorrent-aabb', success: true, message: 'Accepted' });
    expect(upstream.qbittorrent.pause).toHaveBeenCalledWith('aabb');
  });
  test.each(['download-1000', 'queue-radarr-queue-17', 'queue-unknown-17'])('rejects non-client or invalid id %s', async id => {
    expect((await app.inject({ method: 'POST', url: `/api/downloads/${id}/remove` })).statusCode).toBe(422);
    expect(upstream.radarr.removeQueueItem).not.toHaveBeenCalled();
  });
  test('upstream false and exceptions never become success for HTTP or AI callers', async () => {
    upstream.qbittorrent.pause.mockResolvedValue({ success: false, message: 'Rejected' });
    expect((await app.inject({ method: 'POST', url: '/api/downloads/queue-qbittorrent-aabb/pause' })).statusCode).toBe(422);
    expect((await pauseDownload('queue-qbittorrent-aabb')).success).toBe(false);
    upstream.nzbget.remove.mockRejectedValue(new Error('private detail'));
    expect(await removeDownload('queue-nzbget-17')).toEqual({ success: false, message: 'nzbget could not complete the action. Check its connection and retry.' });
  });
  test('unsupported per-item pause is not advertised or dispatched', async () => {
    upstream.sonarr.getQueue.mockResolvedValue([{ id: 'queue-17', sourceClient: 'sonarr', status: 'downloading', progress: 10 }]);
    expect((await app.inject('/api/downloads')).json()[0].actions).toEqual(['remove']);
    expect((await app.inject({ method: 'POST', url: '/api/downloads/queue-sonarr-17/pause' })).statusCode).toBe(422);
    expect(upstream.sonarr.pause).not.toHaveBeenCalled();
  });
  test('preserves client speed and recognizes stopped, complete, failed and unknown states', async () => {
    upstream.qbittorrent.getQueue.mockResolvedValue(['stoppedDL', 'uploading', 'error', 'newState'].map((status, index) => ({ id: String(index), status, progress: index === 1 ? 100 : 20, speed: 1048576 })));
    const rows = (await app.inject('/api/downloads')).json();
    expect(rows.map((row: { status: string }) => row.status)).toEqual(['paused', 'completed', 'failed', 'unknown']);
    expect(rows[0].speed).toBe('1.0 MB/s');
  });
  test('partial upstream failure retains healthy rows; total failure is not empty success', async () => {
    upstream.radarr.getQueue.mockRejectedValue(new Error('offline'));
    upstream.sonarr.getQueue.mockResolvedValue([{ id: 'queue-1', status: 'queued' }]);
    expect((await app.inject('/api/downloads')).json()).toHaveLength(1);
    for (const adapter of Object.values(upstream)) adapter.getQueue.mockRejectedValue(new Error('offline'));
    expect((await app.inject('/api/downloads')).statusCode).toBe(503);
  });
});
