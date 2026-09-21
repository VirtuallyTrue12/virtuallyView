import { IntegrationAdapter } from '../adapter-interface.js';
import { Media } from '@virtuallyview/types';

export interface ProwlarrIndexer { id: number; name: string; protocol: string; privacy: string; enabled: boolean; definitionName: string }
export interface ProwlarrIndexerDefinition { definitionName: string; name: string; protocol: string; privacy: string; language: string; description: string }

export class ProwlarrAdapter implements IntegrationAdapter<{ url: string; apiKey: string }> {
  id = 'prowlarr';
  name = 'Prowlarr';
  private config: { url: string; apiKey: string } | null = null;

  async connect(config: { url: string; apiKey: string }) {
    this.config = config;
    return { connected: true, message: 'Connected to Prowlarr' };
  }

  async disconnect() {
    this.config = null;
  }

  async healthCheck() {
    if (!this.config) return { healthy: false, status: 'offline' };
    try {
      const res = await fetch(`${this.config.url}/api/v1/system/status`, {
        headers: { 'X-Api-Key': this.config.apiKey },
        signal: AbortSignal.timeout(2500)
      });
      return { healthy: res.ok, status: res.ok ? 'online' : 'offline' };
    } catch {
      return { healthy: false, status: 'offline' };
    }
  }

  async getStatus() {
    const health = await this.healthCheck();
    return {
      name: 'Prowlarr',
      adapter: 'prowlarr',
      enabled: true,
      healthStatus: health.status,
      url: this.config?.url ?? 'http://localhost:9696',
      lastSync: new Date()
    };
  }

  private headers() {
    const { apiKey } = this.requireConfig();
    return { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };
  }

  /** Indexers already set up in Prowlarr. */
  async listIndexers(): Promise<ProwlarrIndexer[]> {
    const { url } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/indexer`, { headers: this.headers(), signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`Prowlarr returned ${res.status} while listing indexers.`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: Number(r.id), name: String(r.name ?? ''), protocol: String(r.protocol ?? ''), privacy: String(r.privacy ?? ''),
      enabled: r.enable !== false, definitionName: String(r.definitionName ?? '')
    }));
  }

  /** Indexer definitions Prowlarr can add. Public ones need no account. */
  async indexerCatalog(): Promise<ProwlarrIndexerDefinition[]> {
    const { url } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/indexer/schema`, { headers: this.headers(), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Prowlarr returned ${res.status} while reading indexer definitions.`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      definitionName: String(r.definitionName ?? r.implementationName ?? ''), name: String(r.name ?? r.definitionName ?? ''),
      protocol: String(r.protocol ?? ''), privacy: String(r.privacy ?? ''), language: String(r.language ?? ''),
      description: String(r.description ?? '')
    })).filter(d => d.definitionName);
  }

  async addIndexer(definitionName: string): Promise<{ success: boolean; message: string; id?: number }> {
    const { url } = this.requireConfig();
    const schemaRes = await fetch(`${url}/api/v1/indexer/schema`, { headers: this.headers(), signal: AbortSignal.timeout(15000) });
    if (!schemaRes.ok) return { success: false, message: `Prowlarr returned ${schemaRes.status} while reading indexer definitions.` };
    const schema = ((await schemaRes.json()) as Array<Record<string, unknown>>).find(r => (r.definitionName ?? r.implementationName) === definitionName);
    if (!schema) return { success: false, message: `Prowlarr has no indexer called "${definitionName}".` };
    if (schema.privacy !== 'public') return { success: false, message: 'That indexer needs an account. Add it in Prowlarr itself so you can enter your credentials.' };
    const body = { ...schema, name: String(schema.name ?? definitionName), enable: true, appProfileId: 1, tags: [] };
    const res = await fetch(`${url}/api/v1/indexer`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const first = /"errorMessage"\s*:\s*"([^"]+)"/.exec(detail)?.[1];
      return { success: false, message: first ? `Prowlarr could not add it: ${first}` : `Prowlarr rejected the indexer (status ${res.status}).` };
    }
    const created = (await res.json()) as { id?: number };
    return { success: true, message: 'Indexer added. Prowlarr will share it with Radarr, Sonarr and Lidarr.', ...(created.id ? { id: created.id } : {}) };
  }

  async testIndexer(id: number): Promise<{ success: boolean; message: string }> {
    const { url } = this.requireConfig();
    const getRes = await fetch(`${url}/api/v1/indexer/${id}`, { headers: this.headers(), signal: AbortSignal.timeout(6000) });
    if (!getRes.ok) return { success: false, message: 'Prowlarr could not find that indexer.' };
    const res = await fetch(`${url}/api/v1/indexer/test`, { method: 'POST', headers: this.headers(), body: JSON.stringify(await getRes.json()), signal: AbortSignal.timeout(30000) });
    if (res.ok) return { success: true, message: 'The indexer answered.' };
    const detail = await res.text().catch(() => '');
    const first = /"errorMessage"\s*:\s*"([^"]+)"/.exec(detail)?.[1];
    return { success: false, message: first ?? `The test failed (status ${res.status}).` };
  }

  async removeIndexer(id: number): Promise<{ success: boolean; message: string }> {
    const { url } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/indexer/${id}`, { method: 'DELETE', headers: this.headers(), signal: AbortSignal.timeout(6000) });
    return res.ok ? { success: true, message: 'Indexer removed.' } : { success: false, message: `Prowlarr returned ${res.status}.` };
  }

  private requireConfig(): { url: string; apiKey: string } {
    if (!this.config) throw new Error('Prowlarr is not connected. Add its URL and API key in Settings.');
    return this.config;
  }

  async search(query: string): Promise<Media[]> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/search?query=${encodeURIComponent(query)}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`Prowlarr returned ${res.status} while searching.`);
    const now = new Date();
    const data = (await res.json()) as Array<{
      guid?: string;
      title?: string;
      size?: number;
      seeders?: number;
      leechers?: number;
      indexer?: string;
      categories?: Array<{ name?: string }>;
      publishDate?: string;
    }>;
    return data.map(r => ({
      id: r.guid ?? `${r.indexer}-${r.title}`,
      title: r.title ?? 'Unknown result',
      type: 'movie' as const,
      status: 'available' as const,
      size: r.size,
      seeders: r.seeders,
      leechers: r.leechers,
      indexer: r.indexer,
      category: r.categories?.[0]?.name,
      createdAt: r.publishDate ? new Date(r.publishDate) : now,
      updatedAt: now
    })) as unknown as Media[];
  }

  async getIndexers() {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/indexer`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Prowlarr returned ${res.status} while listing indexers.`);
    const data = (await res.json()) as Array<{ id?: number; name?: string; enabled?: boolean; definitionName?: string }>;
    return data.map(x => ({
      id: x.id ?? 0,
      name: x.name ?? '',
      enabled: !!x.enabled,
      definitionName: x.definitionName ?? 'Indexer'
    }));
  }

  async getItems(): Promise<Media[]> {
    return [];
  }

  async getItem(): Promise<Media | null> {
    return null;
  }

  async add(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Prowlarr is a search indexer; add media through Radarr or Sonarr instead.' };
  }

  async remove(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Not supported by Prowlarr.' };
  }

  async getQueue() {
    return [];
  }

  async refreshMetadata(): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/command`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ApplicationIndexerSync' }),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return { success: false, message: `Prowlarr could not sync indexers (status ${res.status}).` };
    return { success: true, message: 'Indexer sync started.' };
  }

  async getHistory(): Promise<{ events: { timestamp: Date; service: string; message: string }[] }> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/history?pageSize=50`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Prowlarr returned ${res.status} while listing history.`);
    const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
    return {
      events: (body.records ?? []).map(r => ({
        timestamp: r.date ? new Date(r.date as string) : new Date(),
        service: 'prowlarr',
        message: `${(r.eventType as string) ?? 'event'}: ${(r.title as string) ?? ''}`.trim()
      }))
    };
  }
}
