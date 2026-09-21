import type { FastifyInstance } from 'fastify';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { pingService } from '@virtuallyview/integrations';
import type { IntegrationStatus } from '@virtuallyview/types';
import {
  getManagedAdapters, loadServiceConfig, configureIntegration, toggleIntegration,
  waitForIntegration, IntegrationConfigError
} from '../services/registry.js';

const displayNames: Record<string, string> = {
  radarr: 'Radarr', sonarr: 'Sonarr', prowlarr: 'Prowlarr', lidarr: 'Lidarr',
  bazarr: 'Bazarr', qbittorrent: 'qBittorrent', nzbget: 'NZBGet'
};
const defaultUrls: Record<string, string> = {
  radarr: 'http://localhost:7878', sonarr: 'http://localhost:8989',
  prowlarr: 'http://localhost:9696', lidarr: 'http://localhost:8686',
  bazarr: 'http://localhost:6767', qbittorrent: 'http://localhost:8080',
  nzbget: 'http://localhost:6789'
};

function fallbackUrl(key: string): string {
  return process.env[`${key.toUpperCase()}_URL`] ?? defaultUrls[key] ?? 'http://localhost';
}

async function statusFor(key: string): Promise<IntegrationStatus> {
  await waitForIntegration(key);
  const config = loadServiceConfig()[key];
  const status: IntegrationStatus = {
    name: displayNames[key] ?? key, adapter: key, enabled: config?.enabled !== false,
    healthStatus: 'offline', url: config?.url ?? fallbackUrl(key)
  };
  if (!status.enabled) return status;
  try {
    const live = await getManagedAdapters()[key].getStatus();
    return {
      ...live, ...status, healthStatus: live.healthStatus,
      setupRequired: live.healthStatus === 'setup_required',
      lastSync: live.healthStatus === 'online' ? live.lastSync : undefined
    };
  } catch {
    return status;
  }
}

export default async function integrationsRoutes(server: FastifyInstance) {
  // Unsupported entries retain their reachability-only toggle capability.
  // They never represent a connected managed adapter.
  const extras: Record<string, IntegrationStatus> = {
    sabnzbd: { name: 'SABnzbd (not yet supported)', adapter: 'sabnzbd', enabled: false, healthStatus: 'offline', url: 'http://localhost:8080' },
    plex: { name: 'Plex (not yet supported)', adapter: 'plex', enabled: false, healthStatus: 'offline', url: 'http://localhost:32400' },
    emby: { name: 'Emby (not yet supported)', adapter: 'emby', enabled: false, healthStatus: 'offline', url: 'http://localhost:8096' }
  };

  server.get('/api/integrations', async () => {
    const out = await Promise.all(Object.keys(getManagedAdapters()).map(statusFor));
    for (const extra of Object.values(extras)) {
      const healthStatus = extra.enabled ? (await pingService(extra.url, 2500)).status : 'offline';
      out.push({ ...extra, healthStatus, lastSync: healthStatus === 'online' ? new Date() : undefined });
    }
    return out;
  });

  // Scans the usual local addresses for each managed service so the UI can
  // offer a one-click connect instead of asking the user to know the URL.
  server.get('/api/integrations/detect', async () => {
    const keys = Object.keys(getManagedAdapters());
    const results = await Promise.all(keys.map(async (key) => {
      const config = loadServiceConfig()[key];
      const candidates = [config?.url, process.env[`${key.toUpperCase()}_URL`], defaultUrls[key]]
        .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
      const seen = new Set<string>();
      for (const candidate of candidates) {
        const url = candidate.trim();
        if (seen.has(url)) continue;
        seen.add(url);
        try {
          const pong = await pingService(url, 1200);
          if (pong.status === 'online') return { adapter: key, url, reachable: true };
        } catch { /* keep scanning the next address */ }
      }
      return { adapter: key, url: candidates[0] ?? defaultUrls[key], reachable: false };
    }));
    return results;
  });

  server.post<{ Params: { adapter: string } }>('/api/integrations/:adapter/toggle', async (request, reply) => {
    const { adapter } = request.params;
    if (Object.hasOwn(getManagedAdapters(), adapter)) {
      try {
        await toggleIntegration(adapter, fallbackUrl(adapter));
        return await statusFor(adapter);
      } catch (error) {
        if (error instanceof IntegrationConfigError) return reply.code(error.statusCode).send({ message: error.message });
        return reply.code(500).send({ message: 'Could not update integration settings.' });
      }
    }
    if (Object.hasOwn(extras, adapter)) {
      const extra = extras[adapter];
      extra.enabled = !extra.enabled;
      extra.healthStatus = extra.enabled ? (await pingService(extra.url, 2500)).status : 'offline';
      extra.lastSync = extra.healthStatus === 'online' ? new Date() : undefined;
      return { ...extra };
    }
    return reply.code(404).send({ message: `Integration "${adapter}" not found.` });
  });

  server.post<{
    Params: { adapter: string };
    Body: { url: string; apiKey?: string };
  }>('/api/integrations/:adapter/config', async (request, reply) => {
    const { adapter } = request.params;
    const { url, apiKey } = request.body ?? {};
    if (!Object.hasOwn(getManagedAdapters(), adapter)) {
      return reply.code(404).send({ message: `Integration "${adapter}" not found.` });
    }
    if (typeof url !== 'string' || !url || (apiKey !== undefined && typeof apiKey !== 'string')) {
      return reply.code(400).send({ message: 'Enter the service address and its key to connect.' });
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('scheme');
      // Do not permit credentials in a URL that is returned as safe metadata.
      if (parsed.username || parsed.password) throw new Error('credentials');
      const host = parsed.hostname.toLowerCase();
      const trustedServiceHost = /^(radarr|sonarr|prowlarr|lidarr|bazarr|qbittorrent|nzbget|ollama)$/.test(host);
      const address = isIP(host) ? host : trustedServiceHost ? undefined : (await lookup(host)).address;
      const privateAddress = address && (
        address === '127.0.0.1' || address === '::1' || address.startsWith('10.') ||
        address.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
        address.startsWith('169.254.') || address === '0.0.0.0' || address === '::'
      );
      if (privateAddress && !trustedServiceHost) throw new Error('private');
    } catch {
      return reply.code(400).send({ message: 'That address is invalid or points to a private network. Check it and try again.' });
    }
    try {
      await configureIntegration(adapter, url, apiKey);
      return { ...(await statusFor(adapter)), connected: true };
    } catch (error) {
      if (error instanceof IntegrationConfigError) return reply.code(error.statusCode).send({ message: error.message });
      return reply.code(500).send({ message: 'Could not update integration settings.' });
    }
  });
}
