import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DATA_DIR } from '../lib/paths.js';
import { getManagedAdapters, waitForIntegration, type ServiceConfig } from '../services/registry.js';

const CHECK_TIMEOUT_MS = 7000;
const names: Record<string, string> = {
  radarr: 'Radarr', sonarr: 'Sonarr', prowlarr: 'Prowlarr', lidarr: 'Lidarr',
  bazarr: 'Bazarr', qbittorrent: 'qBittorrent', nzbget: 'NZBGet'
};
const versions: Record<string, string> = { radarr: 'v3', sonarr: 'v3', lidarr: 'v1', prowlarr: 'v1' };
type CheckStatus = 'passed' | 'warning' | 'failed' | 'not_checked';
type ServiceStatus = 'online' | 'offline' | 'timeout' | 'setup_required' | 'disabled' | 'not_configured' | 'invalid_config' | 'unknown';
interface Observation {
  id: string;
  label: string;
  status: CheckStatus;
  summary: string;
  recovery: string[];
}
interface ServiceResult {
  adapter: string;
  name: string;
  configured: boolean;
  enabled: boolean;
  status: ServiceStatus;
  checkedAt: string | null;
  durationMs: number | null;
  summary: string;
  recovery: string[];
  observations: Observation[];
}
class CheckTimeout extends Error {}

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CheckTimeout()), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const elapsed = (start: number) => Math.max(0, Math.round(performance.now() - start));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function validEntry(value: unknown): value is ServiceConfig {
  if (!isRecord(value) || typeof value.url !== 'string' || typeof value.apiKey !== 'string' ||
      !value.apiKey.trim() || (value.enabled !== undefined && typeof value.enabled !== 'boolean')) return false;
  try {
    const url = new URL(value.url);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname;
  } catch { return false; }
}

const configRecovery = ['Open Settings > Services and save a valid service URL and credential.',
  'For qBittorrent and NZBGet, use username:password in the credential field.'];
const connectionRecovery = ['Confirm the service is running and reachable from the dashboard server.',
  'Check its URL, API credential, and any reverse-proxy authentication in Settings, then retry.'];
const pathRecovery = ['In the media manager, inspect its download-client settings and remote path mappings.',
  'Verify the download client and media manager see the same completed-download directory and that their service users have the required permissions.'];
const indexerRecovery = ['Open Prowlarr and check that at least one indexer is enabled.',
  'Review indexer credentials, categories, and application sync settings in the service UI, then retry.'];

// Do not forward raw health messages, URLs (including query/userinfo), paths,
// indexer names, config keys, or exceptions. Only fixed labels and counts leave
// this module. No shell, container control, writes, searches, or repair actions.
async function healthObservations(key: string, config: ServiceConfig): Promise<Observation[]> {
  const version = versions[key];
  if (!version) return [{
    id: 'download-paths', label: 'Download paths', status: 'not_checked',
    summary: 'This adapter does not expose path health. No filesystem or write-access test was performed.', recovery: pathRecovery
  }];
  try {
    const url = new URL(config.url);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/api/${version}/health`;
    const response = await fetch(url, {
      method: 'GET', headers: { 'X-Api-Key': config.apiKey },
      signal: AbortSignal.timeout(2500), redirect: 'error'
    });
    if (!response.ok) throw new Error('health unavailable');
    const records: unknown = await response.json();
    if (!Array.isArray(records) || !records.every(item => isRecord(item) && typeof item.source === 'string' && typeof item.type === 'string')) {
      throw new Error('invalid health response');
    }
    const problems = records.filter(item => /^(warning|error)$/i.test(item.type));
    const pathProblems = problems.filter(item => /download.*(path|import|root)|remotepathmapping|rootfolder|diskspace/i.test(item.source));
    const indexerProblems = problems.filter(item => /indexer/i.test(item.source));
    return [
      {
        id: 'service-health', label: 'Service-reported health', status: problems.length ? 'warning' : 'passed',
        summary: `${problems.length} warning/error health records reported by the service.`,
        recovery: problems.length ? ['Open the service\'s System > Status page to review its health messages.'] : []
      },
      {
        id: 'download-paths', label: 'Download paths', status: pathProblems.length ? 'warning' : 'not_checked',
        summary: pathProblems.length
          ? `${pathProblems.length} download-path, root-folder, or disk-space health warnings reported. No direct filesystem test was performed.`
          : 'No matching path warnings in the service health response. Filesystem access and path mappings were not tested.',
        recovery: pathProblems.length ? pathRecovery : []
      },
      {
        id: 'indexer-health', label: 'Indexer health warnings', status: indexerProblems.length ? 'warning' : 'passed',
        summary: `${indexerProblems.length} indexer health warnings reported. No indexer searches or tests were run.`,
        recovery: indexerProblems.length ? indexerRecovery : []
      }
    ];
  } catch {
    return [{
      id: 'service-health', label: 'Service-reported health', status: 'not_checked',
      summary: 'Detailed health could not be read. Indexer and download-path health are unknown.',
      recovery: ['Review System > Status in the service UI.', ...pathRecovery]
    }];
  }
}

// Adapter healthCheck has no cancellation argument. Retain pending work until
// it actually settles so repeated refreshes cannot multiply a hung probe.
const pending = new Map<string, Promise<{ healthy: boolean; status: string }>>();
function probe(key: string, check: () => Promise<{ healthy: boolean; status: string }>) {
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = (async () => { await waitForIntegration(key); return check(); })();
  pending.set(key, operation);
  void operation.then(() => pending.delete(key), () => pending.delete(key));
  return operation;
}

export async function collectDiagnostics(timeoutMs = CHECK_TIMEOUT_MS) {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const configStarted = performance.now();
  let config: Record<string, unknown> = {};
  let configStatus: 'readable' | 'missing' | 'invalid' | 'unreadable' = 'readable';
  try {
    const raw = await bounded(readFile(resolve(DATA_DIR, 'integrations.json'), 'utf8'), timeoutMs);
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) configStatus = 'invalid';
    else config = parsed;
  } catch (error) {
    configStatus = error instanceof SyntaxError ? 'invalid'
      : isRecord(error) && error.code === 'ENOENT' ? 'missing' : 'unreadable';
  }
  const configuration = {
    status: configStatus, checkedAt: new Date().toISOString(), durationMs: elapsed(configStarted),
    summary: configStatus === 'readable' ? 'Saved integration configuration was read and parsed. Entries are validated individually below.'
      : configStatus === 'missing' ? 'No saved integration configuration was found.'
      : configStatus === 'invalid' ? 'Saved integration configuration is not a valid JSON object.'
      : 'Saved integration configuration could not be read within the check deadline.',
    recovery: configStatus === 'readable' ? [] : configStatus === 'missing' ? configRecovery
      : ['Check the server data directory permissions and restore valid integrations.json from a trusted backup. Never share the file; it contains credentials.']
  };
  const adapters = getManagedAdapters();
  const services: ServiceResult[] = await Promise.all(Object.entries(adapters).map(async ([key, adapter]) => {
    const entry = config[key];
    const configured = Object.hasOwn(config, key);
    const enabled = configured && !(isRecord(entry) && entry.enabled === false);
    const result: ServiceResult = {
      adapter: key, name: names[key] ?? 'Managed service', configured, enabled,
      status: 'unknown', checkedAt: null, durationMs: null, summary: '', recovery: [], observations: []
    };
    if (configStatus !== 'readable' && configStatus !== 'missing') {
      return { ...result, summary: 'Configuration could not be verified; no probe was run.', recovery: configuration.recovery };
    }
    if (!configured) return { ...result, status: 'not_configured', summary: 'Supported adapter; no saved configuration. No probe was run.', recovery: configRecovery };
    if (!enabled) return { ...result, status: 'disabled', summary: 'Disabled in saved configuration. No probe was run.' };
    if (!validEntry(entry)) return { ...result, status: 'invalid_config', summary: 'The saved URL or credential is missing or invalid. No probe was run.', recovery: configRecovery };
    if (['qbittorrent', 'nzbget'].includes(key)) {
      const separator = entry.apiKey.indexOf(':');
      if (separator < 1 || separator === entry.apiKey.length - 1) {
        return { ...result, status: 'invalid_config', summary: 'This download client requires a username:password credential. No probe was run.', recovery: configRecovery };
      }
    }
    const checkStarted = performance.now();
    result.checkedAt = new Date().toISOString();
    try {
      const health = await bounded(probe(key, () => adapter.healthCheck()), timeoutMs);
      if (health.status === 'setup_required') {
        result.status = 'setup_required'; result.summary = 'The service reports that initial setup is required.';
        result.recovery = ['Complete initial setup in the service UI, save its credential in Settings, and retry.'];
      } else if (health.healthy === true && health.status === 'online') {
        result.status = 'online'; result.summary = 'The adapter\'s live health check succeeded. This does not verify searches, downloads, or playback.';
      } else {
        result.status = 'offline'; result.summary = 'The adapter health check did not succeed. It does not distinguish authentication, timeout, or network failures.';
        result.recovery = connectionRecovery;
      }
    } catch (error) {
      result.status = error instanceof CheckTimeout ? 'timeout' : 'offline';
      result.summary = error instanceof CheckTimeout ? 'The live health check exceeded its deadline.' : 'The live health check failed; upstream error details were withheld.';
      result.recovery = connectionRecovery;
    }
    result.durationMs = elapsed(checkStarted);
    if (result.status === 'online') {
      try {
        result.observations = await bounded(healthObservations(key, entry), Math.min(timeoutMs, 3000));
      } catch {
        result.observations = [{ id: 'service-health', label: 'Service-reported health', status: 'not_checked',
          summary: 'Detailed health exceeded its deadline. Indexer and download-path health are unknown.',
          recovery: ['Review System > Status in the service UI.', ...pathRecovery] }];
      }
      if (key === 'prowlarr' && 'getIndexers' in adapter) {
        try {
          const indexers = await bounded(adapter.getIndexers(), timeoutMs);
          const enabledCount = indexers.filter(item => item.enabled).length;
          result.observations.push({
            id: 'indexers', label: 'Configured indexers', status: enabledCount ? 'passed' : 'warning',
            summary: `${indexers.length} configured; ${enabledCount} enabled. Configuration only; indexer connectivity was not tested.`,
            recovery: enabledCount ? [] : indexerRecovery
          });
        } catch {
          result.observations.push({ id: 'indexers', label: 'Configured indexers', status: 'not_checked',
            summary: 'The indexer list could not be read within the check deadline.', recovery: indexerRecovery });
        }
      }
    }
    return result;
  }));
  const online = services.filter(service => service.status === 'online').length;
  const failed = services.filter(service => ['offline', 'timeout', 'setup_required', 'invalid_config'].includes(service.status)).length;
  const unknown = services.filter(service => service.status === 'unknown').length;
  const unsupportedConfigured = Object.keys(config).filter(key => !Object.hasOwn(adapters, key)).length;
  const warnings = services.some(service => service.observations.some(check => check.status === 'warning'));
  const incomplete = services.some(service => service.status === 'online' && service.observations.some(check => check.id !== 'download-paths' && check.status === 'not_checked'));
  return {
    startedAt, completedAt: new Date().toISOString(), durationMs: elapsed(started), timeoutMs,
    status: failed || unknown || warnings || unsupportedConfigured || configStatus === 'invalid' || configStatus === 'unreadable' ? 'attention'
      : online === 0 ? 'not_checked' : incomplete ? 'partial' : 'checked',
    counts: {
      supported: services.length, configured: Object.keys(config).length,
      supportedConfigured: services.filter(service => service.configured).length,
      unsupportedConfigured, enabled: services.filter(service => service.enabled).length,
      checked: services.filter(service => service.checkedAt !== null).length,
      online, failed, disabled: services.filter(service => service.status === 'disabled').length,
      notConfigured: services.filter(service => service.status === 'not_configured').length
    },
    configuration, services,
    limitations: [
      'Read-only observations, not an end-to-end audit. No downloads, indexer searches, playback, filesystem writes, or repair actions were attempted.',
      'Service timings cover the adapter health check, including any wait for an existing configuration update. Detailed observations are included in the report duration.',
      'Adapter checks may internally time out before the diagnostics deadline; those failures are reported without guessing their cause.',
      'URLs, credentials, filesystem paths, indexer names, and raw upstream messages are omitted from this report.'
    ]
  };
}

export default async function diagnosticsRoutes(server: FastifyInstance) {
  // Registered beneath the server's normal API authentication preHandler.
  let inFlight: ReturnType<typeof collectDiagnostics> | undefined;
  server.get('/api/diagnostics', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      if (!inFlight) {
        inFlight = collectDiagnostics();
        void inFlight.then(() => { inFlight = undefined; }, () => { inFlight = undefined; });
      }
      return await inFlight;
    } catch {
      // Never send secret-bearing failures to the global error logger.
      return reply.code(503).send({ message: 'Diagnostics could not be collected. Retry shortly.' });
    }
  });
}
