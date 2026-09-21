import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import {
  RadarrAdapter,
  SonarrAdapter,
  ProwlarrAdapter,
  LidarrAdapter,
  BazarrAdapter,
  QBittorrentAdapter,
  NZBGetAdapter
} from '@virtuallyview/integrations';

export interface ServiceConfig {
  url: string;
  apiKey: string;
  enabled?: boolean;
}

export interface AdapterLike<T = unknown> {
  connect(config: { url: string; apiKey: string }): Promise<T>;
  disconnect(): Promise<void>;
}

export type ManagedAdapter =
  | RadarrAdapter
  | SonarrAdapter
  | ProwlarrAdapter
  | LidarrAdapter
  | BazarrAdapter
  | QBittorrentAdapter
  | NZBGetAdapter;

const CONFIG_PATH = resolve(DATA_DIR, 'integrations.json');

export function loadServiceConfig(): Record<string, ServiceConfig> {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Record<string, ServiceConfig>;
  } catch {
    return {};
  }
}

const factories: Record<string, () => ManagedAdapter> = {
  radarr: () => new RadarrAdapter(),
  sonarr: () => new SonarrAdapter(),
  prowlarr: () => new ProwlarrAdapter(),
  lidarr: () => new LidarrAdapter(),
  bazarr: () => new BazarrAdapter(),
  qbittorrent: () => new QBittorrentAdapter(),
  nzbget: () => new NZBGetAdapter()
};
const active: Record<string, ManagedAdapter> = Object.create(null);
const registry: Record<string, ManagedAdapter> = Object.create(null);
const pending = new Map<string, Promise<unknown>>();

for (const [key, factory] of Object.entries(factories)) {
  active[key] = factory();
  // Callers such as downloads and media cache these references. Keep the
  // public handle stable while promoting a separately validated candidate.
  registry[key] = new Proxy(active[key], {
    get(_target, property) {
      const value = Reflect.get(active[key], property);
      return typeof value === 'function'
        ? (...args: unknown[]) => Reflect.apply(Reflect.get(active[key], property), active[key], args)
        : value;
    }
  });
}

function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
  const task = (pending.get(key) ?? Promise.resolve()).then(action);
  const settled = task.then(() => undefined, () => undefined);
  pending.set(key, settled);
  void settled.then(() => { if (pending.get(key) === settled) pending.delete(key); });
  return task;
}

async function cleanup(adapter: ManagedAdapter): Promise<void> {
  try { await adapter.disconnect(); } catch { /* Never mask the original outcome. */ }
}

export class IntegrationConfigError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export function waitForIntegration(key: string): Promise<unknown> {
  return pending.get(key) ?? Promise.resolve();
}

// Persist before promotion: validation/connect/write failures leave the active
// adapter and saved credentials untouched. No secret-bearing upstream errors
// escape this boundary.
async function commit(key: string, entry: ServiceConfig): Promise<ServiceConfig> {
  const candidate = factories[key]();
  if (entry.enabled !== false) {
    if (!entry.url || !entry.apiKey?.trim()) {
      throw new IntegrationConfigError(400, 'Enter the service address and its key to connect.');
    }
    try {
      const result = await candidate.connect({ url: entry.url, apiKey: entry.apiKey });
      if (!result.connected || !(await candidate.healthCheck()).healthy) throw new Error('unhealthy');
    } catch {
      await cleanup(candidate);
      throw new IntegrationConfigError(422, 'We could not connect with that address and key. Nothing was saved. Check the address and try again.');
    }
  }
  try {
    saveServiceConfig(key, entry);
  } catch {
    await cleanup(candidate);
    throw new IntegrationConfigError(500, 'Could not save integration settings. Nothing was changed.');
  }
  const previous = active[key];
  active[key] = candidate;
  await cleanup(previous);
  return entry;
}

export function configureIntegration(key: string, url: string, apiKey?: string): Promise<ServiceConfig> {
  getAdapter(key);
  return serialize(key, () => {
    const current = loadServiceConfig()[key];
    const credential = apiKey?.trim() ? apiKey : current?.apiKey ?? '';
    return commit(key, { url, apiKey: credential, enabled: true });
  });
}

export function toggleIntegration(key: string, fallbackUrl: string): Promise<ServiceConfig> {
  getAdapter(key);
  return serialize(key, () => {
    const current = loadServiceConfig()[key];
    return commit(key, {
      url: current?.url ?? fallbackUrl,
      apiKey: current?.apiKey ?? '',
      enabled: current?.enabled === false
    });
  });
}

/**
 * Auto-connects services from environment variables the first time the
 * server boots, so a docker-compose stack that ships its own pre-configured
 * Radarr/Sonarr/Prowlarr/Lidarr/qBittorrent (see docker-compose.yml) is fully
 * connected with zero manual Settings steps. Never overwrites an existing
 * saved config, so anything the user changes by hand always wins.
 */
function bootstrapFromEnv(): void {
  const config = loadServiceConfig();
  let changed = false;

  const envKeys: Record<string, string> = {
    radarr: 'RADARR',
    sonarr: 'SONARR',
    prowlarr: 'PROWLARR',
    lidarr: 'LIDARR',
    bazarr: 'BAZARR',
    nzbget: 'NZBGET'
  };
  for (const [key, prefix] of Object.entries(envKeys)) {
    if (config[key]) continue;
    const url = process.env[`${prefix}_URL`];
    const apiKey = process.env[`${prefix}_API_KEY`];
    if (url && apiKey) {
      config[key] = { url, apiKey, enabled: true };
      changed = true;
    }
  }

  if (!config.qbittorrent) {
    const url = process.env.QBITTORRENT_URL;
    const username = process.env.QBITTORRENT_USERNAME;
    const password = process.env.QBITTORRENT_PASSWORD;
    if (url && username && password) {
      config.qbittorrent = { url, apiKey: `${username}:${password}`, enabled: true };
      changed = true;
    }
  }
  if (!config.nzbget) {
    const url = process.env.NZBGET_URL;
    const username = process.env.NZBGET_USERNAME;
    const password = process.env.NZBGET_PASSWORD;
    if (url && username && password) {
      config.nzbget = { url, apiKey: `${username}:${password}`, enabled: true };
      changed = true;
    }
  }

  if (changed) {
    writeConfig(config);
  }
}

function boot() {
  bootstrapFromEnv();
  const config = loadServiceConfig();
  for (const [key, adapter] of Object.entries(registry)) {
    const entry = config[key];
    if (entry?.enabled !== false && entry?.url && entry?.apiKey) {
      void serialize(key, async () => {
        try {
          const result = await adapter.connect({ url: entry.url, apiKey: entry.apiKey });
          if (!result.connected) await cleanup(active[key]);
        } catch {
          await cleanup(active[key]);
        }
      });
    }
  }
}

boot();

export function getAdapter<T extends ManagedAdapter = ManagedAdapter>(key: string): T {
  const adapter = registry[key];
  if (!adapter) throw new Error(`Unknown integration "${key}".`);
  return adapter as T;
}

export function getManagedAdapters(): Record<string, ManagedAdapter> {
  return registry;
}

function writeConfig(config: Record<string, ServiceConfig>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${CONFIG_PATH}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, CONFIG_PATH);
  } finally {
    // A cleanup error after a successful rename must not report a failed
    // transaction (the new settings are already durable at that point).
    try { rmSync(temporary, { force: true }); } catch { /* Best-effort temporary-file cleanup. */ }
  }
}

export function saveServiceConfig(key: string, entry: ServiceConfig): void {
  const config = loadServiceConfig();
  config[key] = entry;
  writeConfig(config);
}