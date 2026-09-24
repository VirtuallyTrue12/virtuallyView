import type { FastifyInstance } from 'fastify';
import { VERSION } from '../lib/version.js';
import { loadServiceConfig } from '../services/registry.js';
import { outboundFetch } from '../services/outbound.js';
import { helperAction, helperStartAll, helperStatus } from '../services/host-helper.js';

const serviceMap: Record<string, string> = {
  radarr: 'radarr', sonarr: 'sonarr', prowlarr: 'prowlarr', lidarr: 'lidarr',
  bazarr: 'bazarr', qbittorrent: 'qbittorrent', nzbget: 'nzbget', ollama: 'ollama'
};

export default async function serviceLaunchRoutes(server: FastifyInstance) {
  server.get('/api/services/status', async () => {
    const services = ['radarr', 'sonarr', 'prowlarr', 'lidarr', 'bazarr', 'qbittorrent'];
    const result = await helperStatus();
    if (!result.ok) return { running: 0, services, helper: false, error: result.message };
    return { running: result.data!.services.filter(s => s.state === 'running').length, services, helper: true };
  });

  server.get('/api/services/config', async () => {
    try {
      return Object.fromEntries(Object.entries(loadServiceConfig()).map(([key, entry]) => {
        // Legacy saved URLs may contain userinfo or token query parameters.
        // These are not credentials that the settings UI should read back.
        let url = '';
        try {
          const parsed = new URL(entry.url);
          const needsRedaction = !!(parsed.username || parsed.password || parsed.search || parsed.hash);
          parsed.username = '';
          parsed.password = '';
          parsed.search = '';
          parsed.hash = '';
          url = needsRedaction ? parsed.toString() : entry.url;
        } catch { /* Invalid saved URLs are not safe metadata. */ }
        return [key, {
          url, enabled: entry.enabled !== false,
          hasCredentials: typeof entry.apiKey === 'string' && entry.apiKey.trim().length > 0,
          apiKey: ''
        }];
      }));
    } catch {
      return {};
    }
  });

  server.post('/api/services/launch', async () => {
    const result = await helperStartAll();
    if (!result.ok) return { launched: false, message: result.message };
    const started = result.data?.started ?? [];
    return { launched: true, message: started.length ? `Started ${started.join(', ')}.` : 'Everything is already running.' };
  });

  server.get('/api/services/check-update', async () => {
    try {
      const res = await outboundFetch('https://api.github.com/repos/VirtuallyTrue12/virtuallyView/releases/latest', {
        timeoutMs: 5000,
        headers: { 'User-Agent': `virtuallyView/${VERSION}` }
      });
      if (!res.ok) return { available: false, message: 'Could not check for updates.' };
      const data = await res.json() as { tag_name?: string; name?: string; published_at?: string; html_url?: string; body?: string };
      const current = VERSION;
      const latest = (data.tag_name ?? '').replace(/^v/, '');
      const newer = (a: string, b: string) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0); }
        return false;
      };
      return {
        available: latest ? newer(latest, current) : false,
        currentVersion: current,
        latestVersion: data.tag_name ?? 'unknown',
        releaseName: data.name ?? 'unknown',
        publishedAt: data.published_at ?? 'unknown',
        url: data.html_url ?? '#',
        notes: (data.body ?? '').slice(0, 500)
      };
    } catch {
      return { available: false, message: 'Could not reach GitHub. Check your internet connection.' };
    }
  });

  server.post('/api/services/stop/:service', async (request) => {
    const { service } = request.params as { service: string };
    const name = serviceMap[service];
    if (!name) return { stopped: false, message: `Unknown service "${service}".` };
    const result = await helperAction(name, 'stop');
    return result.ok ? { stopped: true, message: `${name} stopped.` } : { stopped: false, message: result.message };
  });

  server.post('/api/services/start/:service', async (request) => {
    const { service } = request.params as { service: string };
    const name = serviceMap[service];
    if (!name) return { started: false, message: `Unknown service "${service}".` };
    const result = await helperAction(name, 'start');
    return result.ok ? { started: true, message: `${name} started.` } : { started: false, message: result.message };
  });
}
