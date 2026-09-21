import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// All registry instances, filesystem operations, DNS and upstream calls are
// isolated before importing routes. No real files, credentials or containers.
const mocks = vi.hoisted(() => {
  const state = {
    files: new Map<string, string>(), instances: [] as any[],
    failWrite: false, failRename: false, healthy: true, connected: true,
    connectError: false, healthError: false, disconnectError: false,
    connectGate: undefined as Promise<void> | undefined
  };
  class Adapter {
    config: { url: string; apiKey: string } | null = null;
    connect = vi.fn(async (config: { url: string; apiKey: string }) => {
      this.config = config;
      if (state.connectGate) await state.connectGate;
      if (state.connectError) throw new Error('upstream leaked test-secret');
      return { connected: state.connected, message: 'test' };
    });
    disconnect = vi.fn(async () => {
      this.config = null;
      if (state.disconnectError) throw new Error('cleanup test-secret');
    });
    healthCheck = vi.fn(async () => {
      if (state.healthError) throw new Error('health test-secret');
      return { healthy: state.healthy, status: state.healthy ? 'online' : 'offline' };
    });
    getStatus = vi.fn(async () => ({
      name: 'Radarr', adapter: 'radarr', enabled: true,
      healthStatus: this.config && state.healthy ? 'online' : 'offline',
      url: this.config?.url ?? 'http://localhost', lastSync: new Date()
    }));
    getItems = vi.fn(async () => this.config ? [{ title: this.config.url }] : []);
    constructor() { state.instances.push(this); }
  }
  return {
    state, Adapter,
    ping: vi.fn(async () => ({ healthy: false, status: 'offline' })),
    lookup: vi.fn(async () => ({ address: '203.0.113.10', family: 4 })),
    write: vi.fn((path: string, content: string) => {
      if (state.failWrite) throw new Error('disk test-secret');
      state.files.set(path, content);
    }),
    rename: vi.fn((from: string, to: string) => {
      if (state.failRename) throw new Error('rename test-secret');
      state.files.set(to, state.files.get(from)!);
      state.files.delete(from);
    })
  };
});
vi.mock('node:fs', () => ({
  existsSync: (path: string) => mocks.state.files.has(path),
  readFileSync: (path: string) => mocks.state.files.get(path),
  writeFileSync: mocks.write, renameSync: mocks.rename,
  mkdirSync: vi.fn(), rmSync: (path: string) => { mocks.state.files.delete(path); }
}));
vi.mock('../../apps/server/src/lib/paths.js', () => ({ DATA_DIR: '/isolated-data' }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('@virtuallyview/integrations', () => ({
  RadarrAdapter: mocks.Adapter, SonarrAdapter: mocks.Adapter,
  ProwlarrAdapter: mocks.Adapter, LidarrAdapter: mocks.Adapter,
  BazarrAdapter: mocks.Adapter, QBittorrentAdapter: mocks.Adapter,
  NZBGetAdapter: mocks.Adapter,
  pingService: mocks.ping
}));

const configPath = '/isolated-data/integrations.json';
const keys = ['radarr', 'sonarr', 'prowlarr', 'lidarr', 'bazarr', 'qbittorrent', 'nzbget'];
let app: FastifyInstance | undefined;
let registry: typeof import('../../apps/server/src/services/registry.js');
function saved() { return JSON.parse(mocks.state.files.get(configPath)!); }
function seed(radarr: Record<string, unknown> = {}) {
  mocks.state.files.set(configPath, JSON.stringify({
    ...Object.fromEntries(keys.map(key => [key, { url: `http://${key}`, apiKey: '', enabled: false }])),
    radarr: { url: 'http://radarr:7878', apiKey: 'test-secret', enabled: true, ...radarr }
  }));
}
async function build() {
  registry = await import('../../apps/server/src/services/registry.js');
  const { default: integrations } = await import('../../apps/server/src/routes/integrations.js');
  const { default: services } = await import('../../apps/server/src/routes/service-launch.js');
  app = Fastify();
  await app.register(integrations);
  await app.register(services);
  await app.ready();
  return app;
}
const save = (payload: unknown) => app!.inject({ method: 'POST', url: '/api/integrations/radarr/config', payload: payload as any });
const toggle = () => app!.inject({ method: 'POST', url: '/api/integrations/radarr/toggle' });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(mocks.state, {
    files: new Map(), instances: [], failWrite: false, failRename: false,
    healthy: true, connected: true, connectError: false, healthError: false,
    disconnectError: false, connectGate: undefined
  });
  mocks.lookup.mockResolvedValue({ address: '203.0.113.10', family: 4 });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real fetch'); }));
  seed();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.unstubAllGlobals();
});

describe('isolated integration lifecycle HTTP boundary', () => {
  test('connects saved enabled adapters exactly once, not on route registration or GET', async () => {
    await build();
    await registry.waitForIntegration('radarr');
    await app!.inject('/api/integrations');
    await app!.inject('/api/services/config');
    expect(mocks.state.instances[0].connect).toHaveBeenCalledTimes(1);
    expect(mocks.state.instances.slice(1).every(a => a.connect.mock.calls.length === 0)).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  test('startup failure is cleaned once and later configuration can recover', async () => {
    mocks.state.connectError = true;
    await build();
    await registry.waitForIntegration('radarr');
    expect(mocks.state.instances[0].connect).toHaveBeenCalledTimes(1);
    expect(mocks.state.instances[0].disconnect).toHaveBeenCalledTimes(1);
    const list = await app!.inject('/api/integrations');
    expect(list.json()[0]).toMatchObject({ healthStatus: 'offline', url: 'http://radarr:7878' });
    expect(list.json()[0]).not.toHaveProperty('lastSync');
    mocks.state.connectError = false;
    expect((await save({ url: 'http://radarr:7878' })).statusCode).toBe(200);
  });

  test('a status exception reports offline rather than retaining a stale online result', async () => {
    await build();
    await registry.waitForIntegration('radarr');
    expect((await app!.inject('/api/integrations')).json()[0].healthStatus).toBe('online');
    mocks.state.instances[0].getStatus.mockRejectedValueOnce(new Error('test-secret'));
    const response = await app!.inject('/api/integrations');
    expect(response.json()[0]).toMatchObject({ healthStatus: 'offline' });
    expect(response.json()[0]).not.toHaveProperty('lastSync');
    expect(response.body).not.toContain('test-secret');
  });

  test('readback uses canonical storage and returns only safe metadata', async () => {
    seed({ url: 'http://user:password@radarr:7878/base?apiKey=query-secret#fragment', extra: 'test-secret' });
    await build();
    const response = await app!.inject('/api/services/config');
    expect(response.json().radarr).toEqual({
      url: 'http://radarr:7878/base', enabled: true, hasCredentials: true, apiKey: ''
    });
    expect(response.json().sonarr).toEqual({ url: 'http://sonarr', enabled: false, hasCredentials: false, apiKey: '' });
    for (const secret of ['test-secret', 'password', 'query-secret', 'fragment']) expect(response.body).not.toContain(secret);
  });

  test.each([undefined, '', '   '])('preserves current credential on an omitted/blank key (%s)', async apiKey => {
    await build();
    const handle = registry.getAdapter('radarr');
    const retainedMethod = handle.getItems;
    const old = mocks.state.instances[0];
    const response = await save({ url: 'http://radarr:7878/new', ...(apiKey === undefined ? {} : { apiKey }) });
    expect(response.statusCode).toBe(200);
    expect(saved().radarr).toEqual({ url: 'http://radarr:7878/new', apiKey: 'test-secret', enabled: true });
    expect(mocks.state.instances.at(-1).connect).toHaveBeenCalledWith({ url: 'http://radarr:7878/new', apiKey: 'test-secret' });
    expect(old.disconnect).toHaveBeenCalledTimes(1);
    expect(registry.getAdapter('radarr')).toBe(handle);
    expect(await retainedMethod()).toEqual([{ title: 'http://radarr:7878/new' }]);
    expect(response.body).not.toContain('test-secret');
    expect(mocks.write.mock.calls[0][0]).toMatch(/^\/isolated-data\/integrations.json\..+\.tmp$/);
    expect((mocks.write.mock.calls[0] as unknown[])[2]).toEqual({ encoding: 'utf8', mode: 0o600 });
  });

  test('new/missing credentials fail without disconnecting the active adapter', async () => {
    seed({ apiKey: '', enabled: false });
    await build();
    expect((await save({ url: 'http://radarr' })).statusCode).toBe(400);
    expect(mocks.state.instances[0].disconnect).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  test.each(['healthy', 'connected', 'connectError', 'healthError', 'failWrite', 'failRename'] as const)(
    'a candidate %s failure preserves the working adapter and persisted state', async failure => {
      await build();
      await registry.waitForIntegration('radarr');
      const before = mocks.state.files.get(configPath);
      const old = mocks.state.instances[0];
      mocks.state[failure] = failure === 'healthy' || failure === 'connected' ? false : true;
      const response = await save({ url: 'http://radarr/new', apiKey: 'replacement-test-key' });
      expect(response.statusCode).toBe(failure.startsWith('fail') ? 500 : 422);
      expect(response.body).not.toContain('test-secret');
      expect(mocks.state.files.get(configPath)).toBe(before);
      expect(old.disconnect).not.toHaveBeenCalled();
      expect(old.config).toEqual({ url: 'http://radarr:7878', apiKey: 'test-secret' });
      expect(mocks.state.instances.at(-1).disconnect).toHaveBeenCalledTimes(1);
      expect([...mocks.state.files.keys()]).toEqual([configPath]);
    }
  );

  test('cleanup rejection does not mask a failed candidate or undo successful promotion', async () => {
    await build();
    await registry.waitForIntegration('radarr');
    mocks.state.disconnectError = true;
    mocks.state.healthy = false;
    expect((await save({ url: 'http://radarr/new', apiKey: 'new-test-key' })).statusCode).toBe(422);
    expect(mocks.state.instances[0].disconnect).not.toHaveBeenCalled();
    mocks.state.healthy = true;
    expect((await save({ url: 'http://radarr/new', apiKey: 'new-test-key' })).statusCode).toBe(200);
    expect(saved().radarr.apiKey).toBe('new-test-key');
  });

  test('toggle persists disabled state, reconnects using the latest saved key, and survives module restart', async () => {
    await build();
    await save({ url: 'http://radarr/new', apiKey: 'new-test-key' });
    expect((await toggle()).json()).toMatchObject({ enabled: false, healthStatus: 'offline' });
    expect(saved().radarr).toEqual({ url: 'http://radarr/new', apiKey: 'new-test-key', enabled: false });
    expect(await registry.getAdapter('radarr').getItems()).toEqual([]);
    await app!.close();
    app = undefined;
    vi.resetModules();
    const firstNewInstance = mocks.state.instances.length;
    await build();
    expect(mocks.state.instances[firstNewInstance].connect).not.toHaveBeenCalled();
    expect((await toggle()).json()).toMatchObject({ enabled: true, healthStatus: 'online', url: 'http://radarr/new' });
    expect(mocks.state.instances.at(-1).connect).toHaveBeenCalledWith({ url: 'http://radarr/new', apiKey: 'new-test-key' });
    expect(saved().radarr.enabled).toBe(true);
  });

  test('failed toggle enable keeps disabled state and failed disable persistence keeps the active connection', async () => {
    await build();
    await registry.waitForIntegration('radarr');
    mocks.state.failWrite = true;
    expect((await toggle()).statusCode).toBe(500);
    expect(saved().radarr.enabled).toBe(true);
    expect(mocks.state.instances[0].disconnect).not.toHaveBeenCalled();
    mocks.state.failWrite = false;
    await toggle();
    mocks.state.healthy = false;
    expect((await toggle()).statusCode).toBe(422);
    expect(saved().radarr.enabled).toBe(false);
  });

  test('startup and overlapping save/toggle operations serialize without stale credential writes', async () => {
    let release!: () => void;
    mocks.state.connectGate = new Promise<void>(resolve => { release = resolve; });
    await build();
    const saving = registry.configureIntegration('radarr', 'http://radarr/new', 'new-test-key');
    const toggling = registry.toggleIntegration('radarr', 'http://unused');
    await Promise.resolve();
    expect(mocks.state.instances).toHaveLength(7);
    expect(mocks.write).not.toHaveBeenCalled();
    release();
    await Promise.all([saving, toggling]);
    expect(saved().radarr).toEqual({ url: 'http://radarr/new', apiKey: 'new-test-key', enabled: false });
    expect(await registry.getAdapter('radarr').getItems()).toEqual([]);
  });

  test.each(['http://192.168.1.12:7878', 'http://10.0.0.2', 'http://127.0.0.1', 'ftp://radarr', 'http://user:password@radarr'])(
    'retains URL restrictions for %s', async url => {
      await build();
      expect((await save({ url, apiKey: 'new-test-key' })).statusCode).toBe(400);
      expect(mocks.write).not.toHaveBeenCalled();
    }
  );

  test('rejects DNS resolving to private LAN without contacting a candidate', async () => {
    mocks.lookup.mockResolvedValue({ address: '192.168.1.10', family: 4 });
    await build();
    expect((await save({ url: 'http://lan.example', apiKey: 'new-test-key' })).statusCode).toBe(400);
    expect(mocks.state.instances).toHaveLength(7);
  });

  test('unknown/prototype adapter keys return 404, and unsupported reachability toggles remain available', async () => {
    await build();
    for (const key of ['missing', '__proto__', 'constructor']) {
      expect((await app!.inject({ method: 'POST', url: `/api/integrations/${key}/toggle` })).statusCode).toBe(404);
      expect((await app!.inject({ method: 'POST', url: `/api/integrations/${key}/config`, payload: { url: 'http://radarr' } })).statusCode).toBe(404);
    }
    const extra = await app!.inject({ method: 'POST', url: '/api/integrations/plex/toggle' });
    expect(extra.json()).toMatchObject({ enabled: true, healthStatus: 'offline' });
    expect(extra.json()).not.toHaveProperty('lastSync');
    expect(mocks.ping).toHaveBeenCalledWith('http://localhost:32400', 2500);
  });
});
