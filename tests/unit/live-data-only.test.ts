import { describe, test, expect, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyPluginAsync } from 'fastify';

// Point the ledger/caches at a throwaway directory before anything opens the
// database. Static `import` statements are hoisted above this assignment, so
// the app modules are loaded dynamically inside loadRoutes() instead - that is
// the only way the env var is in effect when their top-level code (which opens
// SQLite and loads the request ledger) runs.
process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'md-live-data-'));

type AppRoutes = FastifyPluginAsync;
let cachedRoutes: { mediaRoutes: AppRoutes; dashboardRoutes: AppRoutes } | null = null;

async function loadRoutes() {
  if (!cachedRoutes) {
    cachedRoutes = {
      mediaRoutes: (await import('../../apps/server/src/routes/media.js')).default,
      dashboardRoutes: (await import('../../apps/server/src/routes/dashboard.js')).default
    };
  }
  return cachedRoutes;
}

// Builds the real HTTP layer (routes registered on Fastify) and exercises it
// via inject(), with upstream Radarr/Sonarr/Lidarr/Wikipedia all failing, to
// prove the API returns empty/404 states instead of mock data.
describe('live-data-only API surface', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function build() {
    const { mediaRoutes, dashboardRoutes } = await loadRoutes();
    const app = Fastify();
    await app.register(mediaRoutes);
    await app.register(dashboardRoutes);
    await app.ready();
    return app;
  }

  test('/api/movies returns an empty array when Radarr is unreachable (no mock fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/movies' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  test('/api/series and /api/artists return empty arrays when offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const app = await build();
    for (const url of ['/api/series', '/api/artists']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    }
    await app.close();
  });

  test('/api/movies/:id 404s instead of returning a mock Oppenheimer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/movies/mock-movie-001' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
    await app.close();
  });

  test('/api/dashboard has no hero and empty rails when integrations are offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hero).toBeNull();
    expect(body.heroCandidates).toEqual([]);
    for (const rail of body.rails) {
      expect(rail.items).toEqual([]);
    }
    await app.close();
  });

  test('/api/search stays graceful with an empty library', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/search?q=dune' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ query: 'dune', total: 0, items: [] });
    await app.close();
  });
});
