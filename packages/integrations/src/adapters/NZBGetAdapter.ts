import { IntegrationAdapter } from '../adapter-interface.js';
import { Media, Download } from '@virtuallyview/types';

export class NZBGetAdapter implements IntegrationAdapter<{ url: string; apiKey: string }> {
  id = 'nzbget';
  name = 'NZBGet';
  private config: { url: string; apiKey: string } | null = null;

  async connect(config: { url: string; apiKey: string }) {
    this.config = config;
    return { connected: true, message: 'Connected to NZBGet' };
  }

  async disconnect() {
    this.config = null;
  }

  private requireConfig() {
    if (!this.config) throw new Error('NZBGet is not connected. Add its URL and username:password in Settings.');
    const [username, ...rest] = this.config.apiKey.split(':');
    const password = rest.join(':');
    if (!username || !password) throw new Error('NZBGet credentials must be in "username:password" form.');
    return { url: this.config.url.replace(/\/$/, ''), username, password };
  }

  private async rpc(method: string, params: unknown[] = []) {
    const { url, username, password } = this.requireConfig();
    const response = await fetch(`${url}/jsonrpc`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ version: '2.0', method, params, id: Date.now() }),
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error(`NZBGet returned ${response.status}.`);
    const body = (await response.json()) as { error?: { message?: string }; result?: unknown };
    if (body.error) throw new Error(body.error.message ?? 'NZBGet request failed.');
    return body.result;
  }

  async healthCheck() {
    if (!this.config) return { healthy: false, status: 'offline' };
    try {
      await this.rpc('status');
      return { healthy: true, status: 'online' };
    } catch {
      return { healthy: false, status: 'offline' };
    }
  }

  async getStatus() {
    const health = await this.healthCheck();
    return {
      name: this.name,
      adapter: this.id,
      enabled: true,
      healthStatus: health.status,
      url: this.config?.url ?? 'http://localhost:6789',
      lastSync: new Date()
    };
  }

  async search(): Promise<Media[]> { return []; }
  async getItems(): Promise<Media[]> { return []; }
  async getItem(): Promise<Media | null> { return null; }
  async add(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Send NZBs to NZBGet through Radarr, Sonarr, or Lidarr.' };
  }
  async remove(id: string) {
    try {
      await this.rpc('editqueue', ['GroupDelete', [id]]);
      return { success: true, message: 'Removed from NZBGet.' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'NZBGet could not remove that download.' };
    }
  }
  async getQueue(): Promise<Download[]> {
    const groups = (await this.rpc('listgroups')) as Array<Record<string, unknown>>;
    return groups.map(group => ({
      id: String(group.NZBID ?? group.ID ?? ''),
      sourceClient: 'nzbget',
      status: String(group.Status ?? 'queued').toLowerCase(),
      progress: Number(group.DownloadedSizeMB) && Number(group.NZBSizeMB)
        ? Math.round((Number(group.DownloadedSizeMB) / Number(group.NZBSizeMB)) * 100)
        : 0,
      title: String(group.NZBName ?? group.Name ?? 'Unknown download')
    } as Download & { title: string })) as Download[];
  }
  async refreshMetadata(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Not applicable to a download client.' };
  }
  async getHistory() {
    return { events: [] as { timestamp: Date; service: string; message: string }[] };
  }
}
