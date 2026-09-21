import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Registry is mocked before import: no bootstrap, real files, credentials,
// containers, or service requests are used by this suite.
const mocks = vi.hoisted(() => ({
  readFile: vi.fn(), adapters: vi.fn(), wait: vi.fn(), fetch: vi.fn()
}));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('../../apps/server/src/lib/paths.js', () => ({ DATA_DIR: '/isolated-diagnostics' }));
vi.mock('../../apps/server/src/services/registry.js', () => ({
  getManagedAdapters: mocks.adapters, waitForIntegration: mocks.wait
}));
import diagnosticsRoutes, { collectDiagnostics } from '../../apps/server/src/routes/diagnostics.js';

let app: FastifyInstance | undefined;
const secret = 'isolated-secret-do-not-expose';
const config = (extra = {}) => ({ url: 'http://radarr.test:7878', apiKey: secret, enabled: true, ...extra });
function save(entries: Record<string, unknown>) { mocks.readFile.mockResolvedValue(JSON.stringify(entries)); }
function adapter(healthy = true, status = healthy ? 'online' : 'offline') {
  return {
    healthCheck: vi.fn(async () => ({ healthy, status })),
    connect: vi.fn(), disconnect: vi.fn(), add: vi.fn(), remove: vi.fn(), refreshMetadata: vi.fn()
  };
}
function healthResponse(body: unknown = []) { return { ok: true, json: async () => body }; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.wait.mockResolvedValue(undefined);
  mocks.adapters.mockReturnValue({ radarr: adapter() });
  mocks.fetch.mockResolvedValue(healthResponse());
  vi.stubGlobal('fetch', mocks.fetch);
  save({ radarr: config() });
});
afterEach(async () => {
  await app?.close(); app = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('safe, measured diagnostics', () => {
  test('reports timestamps and durations from read-only live observations', async () => {
    const live = adapter();
    mocks.adapters.mockReturnValue({ radarr: live });
    const report = await collectDiagnostics();
    expect(report.status).toBe('checked');
    expect(report.counts).toMatchObject({ supported: 1, configured: 1, checked: 1, online: 1, failed: 0 });
    expect(Date.parse(report.completedAt)).toBeGreaterThanOrEqual(Date.parse(report.startedAt));
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.services[0]).toMatchObject({ status: 'online', durationMs: expect.any(Number), checkedAt: expect.any(String) });
    expect(report.services[0].observations.find(check => check.id === 'download-paths')?.status).toBe('not_checked');
    expect(live.healthCheck).toHaveBeenCalledOnce();
    for (const method of [live.connect, live.disconnect, live.add, live.remove, live.refreshMetadata]) expect(method).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) }));
  });

  test('distinguishes supported, configured, disabled, invalid, and unsupported entries without probing them', async () => {
    const off = adapter(); const missing = adapter(); const invalid = adapter();
    mocks.adapters.mockReturnValue({ radarr: adapter(), sonarr: off, prowlarr: missing, lidarr: invalid });
    save({ radarr: config(), sonarr: config({ enabled: false }), lidarr: config({ apiKey: '' }), [secret]: config() });
    const report = await collectDiagnostics();
    expect(report.counts).toMatchObject({ supported: 4, configured: 4, supportedConfigured: 3, unsupportedConfigured: 1, checked: 1, disabled: 1, notConfigured: 1, failed: 1 });
    expect(report.services.map(service => service.status)).toEqual(['online', 'disabled', 'not_configured', 'invalid_config']);
    expect(report.status).toBe('attention');
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(off.healthCheck).not.toHaveBeenCalled();
    expect(missing.healthCheck).not.toHaveBeenCalled();
    expect(invalid.healthCheck).not.toHaveBeenCalled();
  });

  test('does not interpret all-service failure or no configuration as healthy', async () => {
    mocks.adapters.mockReturnValue({ radarr: adapter(false), sonarr: adapter(false) });
    save({ radarr: config(), sonarr: config() });
    const failed = await collectDiagnostics();
    expect(failed.status).toBe('attention');
    expect(failed.counts).toMatchObject({ online: 0, failed: 2 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    save({});
    const empty = await collectDiagnostics();
    expect(empty.status).toBe('not_checked');
    expect(empty.counts).toMatchObject({ online: 0, checked: 0, configured: 0 });
  });

  test.each(['{broken', 'null', '[]', '42'])('reports invalid saved JSON, not an empty healthy registry (%s)', async raw => {
    mocks.readFile.mockResolvedValue(raw);
    const report = await collectDiagnostics();
    expect(report.configuration.status).toBe('invalid');
    expect(report.configuration.recovery.join(' ')).toContain('trusted backup');
    expect(report.status).toBe('attention');
    expect(report.services[0].status).toBe('unknown');
    expect(report.services[0].checkedAt).toBeNull();
  });

  test('separates missing configuration from permission/read failures without exposing errors', async () => {
    mocks.readFile.mockRejectedValue(Object.assign(new Error(secret), { code: 'ENOENT' }));
    expect((await collectDiagnostics()).configuration.status).toBe('missing');
    mocks.readFile.mockRejectedValue(Object.assign(new Error(secret), { code: 'EACCES' }));
    const report = await collectDiagnostics();
    expect(report.configuration.status).toBe('unreadable');
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.status).toBe('attention');
  });

  test('bounds a stalled configuration read', async () => {
    vi.useFakeTimers();
    mocks.readFile.mockReturnValue(new Promise(() => {}));
    const request = collectDiagnostics(20);
    await vi.advanceTimersByTimeAsync(21);
    expect((await request).configuration.status).toBe('unreadable');
  });

  test('bounds stalled adapter checks and reuses pending probes on retry', async () => {
    vi.useFakeTimers();
    let release!: (value: { healthy: boolean; status: string }) => void;
    const slow = adapter();
    slow.healthCheck.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    mocks.adapters.mockReturnValue({ radarr: slow });
    const first = collectDiagnostics(20);
    await vi.advanceTimersByTimeAsync(21);
    expect((await first).services[0].status).toBe('timeout');
    const retry = collectDiagnostics(20);
    await vi.advanceTimersByTimeAsync(21);
    expect((await retry).services[0].status).toBe('timeout');
    expect(slow.healthCheck).toHaveBeenCalledOnce();
    release({ healthy: false, status: 'offline' });
    await Promise.resolve();
  });

  test('waits for registry configuration work within the probe deadline', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    mocks.wait.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const live = adapter(false);
    mocks.adapters.mockReturnValue({ radarr: live });
    const request = collectDiagnostics(20);
    await vi.advanceTimersByTimeAsync(21);
    expect((await request).services[0].status).toBe('timeout');
    expect(live.healthCheck).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  test('withholds upstream status/error/URL secrets and strips userinfo, query, and fragment from detail requests', async () => {
    save({ radarr: config({ url: `http://user:${secret}@radarr.test/base?token=${secret}#${secret}` }) });
    mocks.fetch.mockResolvedValue(healthResponse([{ source: 'IndexerStatusCheck', type: 'warning', message: secret, wikiUrl: secret }]));
    const report = await collectDiagnostics();
    const [url] = mocks.fetch.mock.calls[0];
    expect(url.toString()).toBe('http://radarr.test/base/api/v3/health');
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(JSON.stringify(report)).not.toContain('http://');
    const broken = adapter();
    broken.healthCheck.mockRejectedValue(new Error(`request failed http://user:${secret}@host/?apiKey=${secret}`));
    mocks.adapters.mockReturnValue({ radarr: broken });
    const failed = await collectDiagnostics();
    expect(failed.services[0].status).toBe('offline');
    expect(JSON.stringify(failed)).not.toContain(secret);
  });

  test('surfaces service-reported indexer/path warnings with recovery, never raw messages or paths', async () => {
    mocks.fetch.mockResolvedValue(healthResponse([
      { source: 'DownloadClientRootFolderCheck', type: 'error', message: `/private/${secret}` },
      { source: 'IndexerStatusCheck', type: 'warning', message: secret }
    ]));
    const report = await collectDiagnostics();
    const checks = report.services[0].observations;
    expect(checks.find(check => check.id === 'download-paths')).toMatchObject({ status: 'warning', recovery: expect.arrayContaining([expect.stringContaining('remote path mappings')]) });
    expect(checks.find(check => check.id === 'indexer-health')?.status).toBe('warning');
    expect(report.status).toBe('attention');
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  test('counts enabled Prowlarr indexers without advertising tested connectivity or names', async () => {
    const prowlarr = { ...adapter(), getIndexers: vi.fn(async () => [{ name: secret, enabled: false }]) };
    mocks.adapters.mockReturnValue({ prowlarr });
    save({ prowlarr: config() });
    const report = await collectDiagnostics();
    const check = report.services[0].observations.find(item => item.id === 'indexers');
    expect(check).toMatchObject({ status: 'warning', summary: expect.stringContaining('1 configured; 0 enabled') });
    expect(check?.summary).toContain('connectivity was not tested');
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(prowlarr.getIndexers).toHaveBeenCalledOnce();
  });

  test('marks indexer-list failure as partial and withholds secret-bearing errors', async () => {
    mocks.adapters.mockReturnValue({ prowlarr: { ...adapter(), getIndexers: vi.fn().mockRejectedValue(new Error(secret)) } });
    save({ prowlarr: config() });
    const report = await collectDiagnostics();
    expect(report.status).toBe('partial');
    expect(report.services[0].observations.find(check => check.id === 'indexers')?.status).toBe('not_checked');
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  test('validates download-client credential shape and does not probe invalid credentials', async () => {
    const client = adapter();
    mocks.adapters.mockReturnValue({ qbittorrent: client });
    save({ qbittorrent: config() });
    const report = await collectDiagnostics();
    expect(report.services[0].status).toBe('invalid_config');
    expect(client.healthCheck).not.toHaveBeenCalled();
    expect(report.services[0].recovery.join(' ')).toContain('username:password');
  });

  test('shows unknown detailed health on denied, malformed, or stalled responses, not a pass', async () => {
    mocks.fetch.mockResolvedValue({ ok: false });
    let report = await collectDiagnostics();
    expect(report.status).toBe('partial');
    expect(report.services[0].observations[0].status).toBe('not_checked');
    mocks.fetch.mockResolvedValue(healthResponse({ message: secret }));
    report = await collectDiagnostics();
    expect(report.status).toBe('partial');
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(() => new Promise(() => {}));
    const request = collectDiagnostics(20);
    await vi.advanceTimersByTimeAsync(21);
    expect((await request).status).toBe('partial');
  });

  test('reports setup required and exposes no accidental success from contradictory adapter status', async () => {
    mocks.adapters.mockReturnValue({ radarr: adapter(false, 'setup_required'), sonarr: adapter(true, secret) });
    save({ radarr: config(), sonarr: config() });
    const report = await collectDiagnostics();
    expect(report.services.map(service => service.status)).toEqual(['setup_required', 'offline']);
    expect(report.services[0].recovery.join(' ')).toContain('initial setup');
    expect(report.counts.online).toBe(0);
    expect(JSON.stringify(report)).not.toContain(secret);
  });
});

describe('diagnostics HTTP boundary', () => {
  test('inherits the normal auth hook, uses no-store, and only registers GET', async () => {
    app = Fastify();
    // Mimics the enclosing API hook; this plugin must not exempt itself.
    app.addHook('preHandler', async (request, reply) => {
      if (request.headers.cookie !== 'vv_session=isolated-session') return reply.code(401).send({ message: 'Authentication required.' });
    });
    await app.register(diagnosticsRoutes);
    const denied = await app.inject('/api/diagnostics');
    expect(denied.statusCode).toBe(401);
    expect(mocks.readFile).not.toHaveBeenCalled();
    const allowed = await app.inject({ url: '/api/diagnostics', headers: { cookie: 'vv_session=isolated-session' } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['cache-control']).toBe('no-store');
    expect(allowed.body).not.toContain(secret);
    expect((await app.inject({ method: 'POST', url: '/api/diagnostics', headers: { cookie: 'vv_session=isolated-session' } })).statusCode).toBe(404);
  });

  test('contains unexpected collection errors without sending them to the global logger', async () => {
    mocks.adapters.mockImplementation(() => { throw new Error(secret); });
    app = Fastify();
    const log = vi.spyOn(app.log, 'error');
    const errorHandler = vi.fn((_error, _request, reply) => reply.code(500).send({ message: 'unexpected' }));
    app.setErrorHandler(errorHandler);
    await app.register(diagnosticsRoutes);
    const response = await app.inject('/api/diagnostics');
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(secret);
    expect(errorHandler).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
