import type { FastifyInstance } from 'fastify';
import { execFileSync, execSync } from 'node:child_process';
import { loadServiceConfig } from '../services/registry.js';
import { outboundFetch } from '../services/outbound.js';

const serviceMap: Record<string, string> = {
  radarr: 'radarr', sonarr: 'sonarr', prowlarr: 'prowlarr', lidarr: 'lidarr',
  bazarr: 'bazarr', qbittorrent: 'qbittorrent', app: 'app', ollama: 'ollama'
};

export default async function serviceLaunchRoutes(server: FastifyInstance) {
  server.get('/api/services/status', async () => {
    try {
      const output = execSync('docker-compose ps --format json 2>/dev/null || echo "[]"', { encoding: 'utf8', timeout: 5000 }).trim();
      const lines = output.split('\n').filter(l => l.trim());
      const running = lines.filter(l => l.includes('Up') || l.includes('running'));
      return { running: running.length, services: ['radarr', 'sonarr', 'prowlarr', 'lidarr', 'bazarr', 'qbittorrent'] };
    } catch {
      return { running: 0, services: ['radarr', 'sonarr', 'prowlarr', 'lidarr', 'bazarr', 'qbittorrent'], error: 'Could not query docker-compose status.' };
    }
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
    try {
      execFileSync('docker-compose', ['up', '-d'], { timeout: 10000, stdio: 'pipe' });
      return { launched: true, message: 'Service containers started or updated via docker-compose.' };
    } catch (err) {
      return { launched: false, message: (err as Error).message ?? 'Failed to start services.' };
    }
  });

  server.get('/api/services/check-update', async () => {
    try {
      const res = await outboundFetch('https://api.github.com/repos/anomalyco/opencode/releases/latest', {
        timeoutMs: 5000,
        headers: { 'User-Agent': 'VirtuallyView/1.0.0' }
      });
      if (!res.ok) return { available: false, message: 'Could not check for updates.' };
      const data = await res.json() as { tag_name?: string; name?: string; published_at?: string; html_url?: string; body?: string };
      return {
        available: true,
        currentVersion: '1.0.0',
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
    try {
      const name = serviceMap[service];
      if (!name) return { stopped: false, message: `Unknown service "${service}".` };
      execFileSync('docker-compose', ['stop', name], { timeout: 15000, stdio: 'pipe', env: process.env });
      return { stopped: true, message: `${name} stopped.` };
    } catch (err) {
      return { stopped: false, message: (err as Error).message ?? 'Failed to stop.' };
    }
  });

  server.post('/api/services/start/:service', async (request) => {
    const { service } = request.params as { service: string };
    try {
      const name = serviceMap[service];
      if (!name) return { started: false, message: `Unknown service "${service}".` };
      execFileSync('docker-compose', ['up', '-d', name], { timeout: 15000, stdio: 'pipe', env: process.env });
      return { started: true, message: `${name} started.` };
    } catch (err) {
      return { started: false, message: (err as Error).message ?? 'Failed to start.' };
    }
  });
}
