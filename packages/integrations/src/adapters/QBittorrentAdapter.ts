import { IntegrationAdapter } from '../adapter-interface.js';
import { Media, Download } from '@virtuallyview/types';

/**
 * qBittorrent's WebUI API authenticates with a username/password login that
 * returns a session cookie, not an API key. To reuse the app's single
 * "URL + API key" integration config shape, the API key field is expected to
 * hold "username:password".
 */
export interface TorrentInfo {
  hash: string;
  name: string;
  category: string;
  state: string;
  /** 0 to 100. */
  progress: number;
  savePath: string;
  contentPath: string;
  size: number;
}

export class QBittorrentAdapter implements IntegrationAdapter<{ url: string; apiKey: string }> {
  id = 'qbittorrent';
  name = 'qBittorrent';
  private config: { url: string; apiKey: string } | null = null;
  private sessionCookie: string | null = null;

  async connect(config: { url: string; apiKey: string }) {
    this.config = config;
    this.sessionCookie = null;
    return { connected: true, message: 'Connected to qBittorrent' };
  }

  async disconnect() {
    this.config = null;
    this.sessionCookie = null;
  }

  private requireConfig(): { url: string; username: string; password: string } {
    if (!this.config) throw new Error('qBittorrent is not connected. Add its URL and "username:password" in Settings.');
    const [username, ...rest] = this.config.apiKey.split(':');
    const password = rest.join(':');
    if (!username || !password) {
      throw new Error('qBittorrent credentials must be in "username:password" form.');
    }
    return { url: this.config.url, username, password };
  }

  private async login(): Promise<void> {
    const { url, username, password } = this.requireConfig();
    const res = await fetch(`${url}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
      body: new URLSearchParams({ username, password }),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) {
      throw new Error('qBittorrent rejected that username/password.');
    }
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) throw new Error('qBittorrent did not return a session cookie.');
    this.sessionCookie = setCookie.split(';')[0];
  }

  private async authedFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const { url } = this.requireConfig();
    if (!this.sessionCookie) await this.login();
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Cookie: this.sessionCookie ?? '', Referer: url },
      signal: AbortSignal.timeout(6000)
    });
    if (res.status === 403 && !retried) {
      this.sessionCookie = null;
      return this.authedFetch(path, init, true);
    }
    return res;
  }

  async healthCheck() {
    if (!this.config) return { healthy: false, status: 'offline' };
    try {
      const res = await this.authedFetch('/api/v2/app/version');
      return { healthy: res.ok, status: res.ok ? 'online' : 'offline' };
    } catch {
      return { healthy: false, status: 'offline' };
    }
  }

  async getStatus() {
    const health = await this.healthCheck();
    return {
      name: 'qBittorrent',
      adapter: 'qbittorrent',
      enabled: true,
      healthStatus: health.status,
      url: this.config?.url ?? 'http://localhost:8080',
      lastSync: new Date()
    };
  }

  async search(): Promise<Media[]> {
    return [];
  }

  async getItems(): Promise<Media[]> {
    return [];
  }

  async getItem(): Promise<Media | null> {
    return null;
  }

  async add(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Send torrents to qBittorrent through Radarr/Sonarr, not directly.' };
  }

  async remove(mediaId: string): Promise<{ success: boolean; message: string }> {
    const res = await this.authedFetch('/api/v2/torrents/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hashes: mediaId, deleteFiles: 'false' })
    });
    if (!res.ok) return { success: false, message: `qBittorrent could not remove that torrent (status ${res.status}).` };
    return { success: true, message: 'Removed from qBittorrent.' };
  }

  /** Remove a torrent AND delete its files from disk. Deliberately explicit. */
  async removeWithFiles(hash: string): Promise<{ success: boolean; message: string }> {
    const res = await this.authedFetch('/api/v2/torrents/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hashes: hash, deleteFiles: 'true' })
    });
    if (!res.ok) return { success: false, message: `qBittorrent could not delete that torrent and its files (status ${res.status}).` };
    return { success: true, message: 'Removed from qBittorrent and its files were deleted.' };
  }

  private postForm(path: string, hash: string): Promise<Response> {
    return this.authedFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hashes: hash })
    });
  }

  async pause(hash: string): Promise<{ success: boolean; message: string }> {
    // qBittorrent 5 renamed pause -> stop; older builds only know pause.
    let res = await this.postForm('/api/v2/torrents/stop', hash);
    if (res.status === 404) res = await this.postForm('/api/v2/torrents/pause', hash);
    if (!res.ok) return { success: false, message: `qBittorrent could not pause that torrent (status ${res.status}).` };
    return { success: true, message: 'Paused.' };
  }

  async resume(hash: string): Promise<{ success: boolean; message: string }> {
    // qBittorrent 5 renamed resume -> start; older builds only know resume.
    let res = await this.postForm('/api/v2/torrents/start', hash);
    if (res.status === 404) res = await this.postForm('/api/v2/torrents/resume', hash);
    if (!res.ok) return { success: false, message: `qBittorrent could not resume that torrent (status ${res.status}).` };
    return { success: true, message: 'Resumed.' };
  }

  async getQueue(): Promise<Download[]> {
    const res = await this.authedFetch('/api/v2/torrents/info');
    if (!res.ok) throw new Error(`qBittorrent returned ${res.status} while listing torrents.`);
    const data = (await res.json()) as Array<{
      hash?: string;
      name?: string;
      progress?: number;
      state?: string;
      size?: number;
      dlspeed?: number;
      eta?: number;
      save_path?: string;
      category?: string;
    }>;
    return data.map(t => ({
      id: t.hash ?? '',
      sourceClient: 'qbittorrent',
      status: t.state ?? 'unknown',
      progress: Math.round((t.progress ?? 0) * 100),
      speed: t.dlspeed,
      size: t.size,
      savePath: t.save_path,
      category: t.category ?? '',
      title: t.name
    } as Download & { title?: string })) as Download[];
  }

  /** Every torrent with the fields needed to tell whose it is (category) and where it lives. */
  async listTorrents(): Promise<TorrentInfo[]> {
    const res = await this.authedFetch('/api/v2/torrents/info');
    if (!res.ok) throw new Error(`qBittorrent returned ${res.status} while listing torrents.`);
    const data = (await res.json()) as Array<Record<string, unknown>>;
    return data.map(t => ({
      hash: String(t.hash ?? ''), name: String(t.name ?? ''), category: String(t.category ?? ''), state: String(t.state ?? ''),
      progress: Math.round(Number(t.progress ?? 0) * 100), savePath: String(t.save_path ?? ''), contentPath: String(t.content_path ?? ''), size: Number(t.size ?? 0)
    })).filter(t => t.hash);
  }

  /** Starts a download from a magnet link. `category` keeps it apart from what Radarr, Sonarr and Lidarr manage. */
  async addMagnet(magnet: string, category: string): Promise<{ success: boolean; message: string }> {
    const res = await this.authedFetch('/api/v2/torrents/add', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ urls: magnet, category })
    });
    return res.ok ? { success: true, message: 'Started.' } : { success: false, message: `qBittorrent returned ${res.status}.` };
  }

  /** Starts a download from the bytes of a .torrent file. */
  async addTorrentFile(bytes: Uint8Array, category: string): Promise<{ success: boolean; message: string }> {
    const form = new FormData();
    form.append('torrents', new Blob([new Uint8Array(bytes)], { type: 'application/x-bittorrent' }), 'release.torrent');
    form.append('category', category);
    const res = await this.authedFetch('/api/v2/torrents/add', { method: 'POST', body: form });
    return res.ok ? { success: true, message: 'Started.' } : { success: false, message: `qBittorrent returned ${res.status}.` };
  }

  /** File names inside one torrent, relative to its folder. */
  async torrentFiles(hash: string): Promise<string[]> {
    const res = await this.authedFetch(`/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`);
    if (!res.ok) throw new Error(`qBittorrent returned ${res.status} while listing files.`);
    return ((await res.json()) as Array<{ name?: string }>).map(f => String(f.name ?? '')).filter(Boolean);
  }

  /** Moves the torrent's data to another folder. It keeps seeding from the new place. */
  async setLocation(hash: string, location: string): Promise<{ success: boolean; message: string }> {
    const res = await this.authedFetch('/api/v2/torrents/setLocation', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hashes: hash, location })
    });
    return res.ok ? { success: true, message: 'Moved.' } : { success: false, message: res.status === 409 ? 'qBittorrent cannot write to that folder.' : `qBittorrent returned ${res.status}.` };
  }

  async refreshMetadata(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Not applicable to a download client.' };
  }

  async getHistory(): Promise<{ events: { timestamp: Date; service: string; message: string }[] }> {
    return { events: [] };
  }
}
