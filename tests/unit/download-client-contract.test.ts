import { afterEach, expect, test, vi } from 'vitest';
import Fastify from 'fastify';
import { QBittorrentAdapter } from '../../packages/integrations/src/adapters/QBittorrentAdapter.js';
const state = vi.hoisted(() => ({ adapter: null as unknown }));
vi.mock('../../apps/server/src/services/registry.js', () => ({
  getAdapter: (key: string) => key === 'qbittorrent' ? state.adapter : { getQueue: async () => [] }
}));
import downloadsRoutes from '../../apps/server/src/routes/downloads.js';
afterEach(() => vi.unstubAllGlobals());
// qBittorrent 5 renamed pause/resume to stop/start (the old names answer 404);
// 4.x only knows pause/resume. The adapter must work against both.
for (const version of ['5.x', '4.x'] as const) test(`HTTP action -> real adapter -> authenticated client -> refreshed queue retains title/progress (qBittorrent ${version})`, async () => {
  const adapter = new QBittorrentAdapter();
  state.adapter = adapter;
  await adapter.connect({ url: 'http://client.test', apiKey: 'fixture:test-password' });
  let torrentState = 'downloading';
  let logins = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    if (path === '/api/v2/auth/login') {
      logins++;
      expect(String(init?.body)).toBe('username=fixture&password=test-password');
      return new Response('Ok.', { headers: { 'set-cookie': 'SID=test-session; HttpOnly' } });
    }
    expect(new Headers(init?.headers).get('cookie')).toBe('SID=test-session');
    if (path === '/api/v2/torrents/info') return Response.json([{ hash: 'aabb', name: 'Contract fixture', progress: 0.42, state: torrentState, size: 1024, dlspeed: 256 }]);
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toBe('hashes=aabb');
    const modern = version === '5.x';
    if (path === (modern ? '/api/v2/torrents/stop' : '/api/v2/torrents/pause') || (!modern && path === '/api/v2/torrents/stop')) {
      if (path.endsWith('/stop') && !modern) return new Response('', { status: 404 });
      torrentState = modern ? 'stoppedDL' : 'pausedDL';
    } else if (path === (modern ? '/api/v2/torrents/start' : '/api/v2/torrents/resume') || (!modern && path === '/api/v2/torrents/start')) {
      if (path.endsWith('/start') && !modern) return new Response('', { status: 404 });
      torrentState = 'downloading';
    } else if (modern && (path.endsWith('/pause') || path.endsWith('/resume'))) return new Response('', { status: 404 });
    else throw new Error(`Unexpected client operation: ${path}`);
    return new Response('');
  }));
  const app = Fastify();
  try {
    await app.register(downloadsRoutes);
    const initial = (await app.inject('/api/downloads')).json()[0];
    expect(initial).toMatchObject({ id: 'queue-qbittorrent-aabb', title: 'Contract fixture', progress: 42, status: 'downloading' });
    for (const [action, expected] of [['pause', 'paused'], ['resume', 'downloading']]) {
      const result = await app.inject({ method: 'POST', url: `/api/downloads/${initial.id}/${action}` });
      expect(result.statusCode).toBe(200);
      expect(result.json().success).toBe(true);
      expect((await app.inject('/api/downloads')).json()[0]).toMatchObject({ id: initial.id, title: initial.title, progress: initial.progress, status: expected });
    }
    expect(logins).toBe(1);
  } finally { await app.close(); }
});
