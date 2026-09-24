import { describe, test, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const sonarr = vi.hoisted(() => ({
  certification: 'TV-MA' as string | undefined,
  fail: false
}));
vi.mock('../../apps/server/src/services/registry.js', () => ({
  getAdapter: (key: string) => key === 'sonarr'
    ? {
        getEpisodeCertification: async () => { if (sonarr.fail) throw new Error('down'); return sonarr.certification; },
        getEpisodeFile: async () => null,
        getItem: async () => null
      }
    : { getItem: async () => null }
}));

import streamRoutes from '../../apps/server/src/routes/stream.js';
import { runAsActor } from '../../apps/server/src/services/user-context.js';

const ROUTES = [
  '/api/stream/episode/episode-9',
  '/api/stream/episode/episode-9/subtitles',
  '/api/stream/episode/episode-9/info',
  '/api/stream/episode/episode-9/transcode',
  '/api/stream/episode/episode-9/embedded/0',
  '/api/stream/episode/episode-9/subtitle/a.srt',
  '/api/stream/episode/episode-9/trickplay',
  '/api/stream/episode/episode-9/trickplay.jpg'
];

async function status(url: string, actor: Parameters<typeof runAsActor>[0]) {
  const app = Fastify();
  // As in the real server: the signed-in person is set before any route runs.
  app.addHook('onRequest', (_request, _reply, done) => { runAsActor(actor, done); });
  await app.register(streamRoutes);
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  return res;
}

const kid = { userId: 'u1', username: 'kid', role: 'user' as const, maxRating: 'PG' };

beforeEach(() => { sonarr.certification = 'TV-MA'; sonarr.fail = false; });

describe('episode playback follows the parent series age limit', () => {
  test.each(ROUTES)('%s is refused for a restricted viewer of an adult series', async url => {
    const res = await status(url, kid);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('age_restricted');
  });

  test('an unrated or unconfirmable series is refused for a restricted viewer', async () => {
    sonarr.certification = undefined;
    expect((await status(ROUTES[0]!, kid)).statusCode).toBe(403);
    sonarr.fail = true;
    expect((await status(ROUTES[0]!, kid)).statusCode).toBe(403);
  });

  test('a series within the limit is not refused (it may 404 only because no file exists here)', async () => {
    sonarr.certification = 'TV-PG';
    expect((await status(ROUTES[0]!, kid)).statusCode).toBe(404);
  });

  test('administrators and unrestricted viewers are unaffected', async () => {
    expect((await status(ROUTES[0]!, { userId: 'a', username: 'admin', role: 'admin' })).statusCode).toBe(404);
    expect((await status(ROUTES[0]!, { userId: 'u2', username: 'grown', role: 'user' })).statusCode).toBe(404);
  });
});
