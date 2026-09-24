import { IntegrationAdapter } from '../adapter-interface.js';
import { Media } from '@virtuallyview/types';

export interface ProwlarrIndexer {
  id: number; name: string; protocol: string; privacy: string; enabled: boolean; definitionName: string;
  /** Set while Prowlarr is skipping it after repeated failures. */
  failingUntil?: string;
}
export interface ProwlarrIndexerDefinition {
  definitionName: string; name: string; protocol: string; privacy: string; language: string; description: string;
  /** Adult (18+) content only: kept apart in the list so nobody adds one by accident. */
  adult: boolean;
}

/** Prowlarr's connection errors, in words a person can act on. */
export function explainIndexerError(raw: string): string {
  const text = raw.replace(/\\u0027/g, "'");
  if (/cloudflare/i.test(text)) return 'This site is behind Cloudflare protection, which Prowlarr cannot get past on its own. Choose another source.';
  if (/ssl|certificate|tls/i.test(text)) return 'The secure connection to this site was cut off. Your internet provider or network is probably blocking it. Choose another source.';
  if (/name.*(not|could not).*resolv|no such host|dns/i.test(text)) return 'This site could not be found. Its address may be blocked by your internet provider, or the site may be gone. Choose another source.';
  if (/timed out|unavailable|unable to connect/i.test(text)) return 'This site is not answering right now. Try again later, or choose another source.';
  if (/captcha/i.test(text)) return 'This site asks for a captcha, which Prowlarr cannot solve. Choose another source.';
  return `Prowlarr could not add it: ${text}`;
}

const ADULT_WORDS = /porn|xxx|adult|hentai|18\+|\bsex|erotic|nsfw|\bjav\b/i;

/** An indexer whose standard categories are all XXX (6000-6999), or that says so in its name. */
export function isAdultIndexer(name: string, description: string, categoryIds: number[]): boolean {
  const standard = categoryIds.filter(id => id < 100000);
  return (standard.length > 0 && standard.every(id => id >= 6000 && id < 7000)) || ADULT_WORDS.test(`${name} ${description}`);
}

export interface ProwlarrRelease {
  guid: string; title: string; indexer: string; indexerId: number;
  size: number; seeders: number; leechers: number; ageDays: number;
  protocol: string; downloadUrl: string;
}

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
    // Prowlarr stops using an indexer for a while after repeated failures; say which.
    const failing = new Map<number, string>();
    try {
      const status = await fetch(`${url}/api/v1/indexerstatus`, { headers: this.headers(), signal: AbortSignal.timeout(6000) });
      if (status.ok) {
        for (const s of (await status.json()) as Array<{ indexerId?: number; disabledTill?: string }>) {
          if (s.indexerId && s.disabledTill && Date.parse(s.disabledTill) > Date.now()) failing.set(s.indexerId, s.disabledTill);
        }
      }
    } catch { /* status is optional: list without it */ }
    return rows.map(r => ({
      id: Number(r.id), name: String(r.name ?? ''), protocol: String(r.protocol ?? ''), privacy: String(r.privacy ?? ''),
      enabled: r.enable !== false, definitionName: String(r.definitionName ?? ''),
      ...(failing.has(Number(r.id)) ? { failingUntil: failing.get(Number(r.id)) } : {})
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
      description: String(r.description ?? ''),
      adult: isAdultIndexer(String(r.name ?? ''), String(r.description ?? ''),
        ((r.capabilities as { categories?: Array<{ id?: number }> } | undefined)?.categories ?? []).map(c => Number(c.id)).filter(Number.isFinite))
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
      return { success: false, message: first ? explainIndexerError(first) : `Prowlarr rejected the indexer (status ${res.status}).` };
    }
    const created = (await res.json()) as { id?: number };
    return { success: true, message: 'Indexer added. Prowlarr will share it with Radarr, Sonarr and Lidarr.', ...(created.id ? { id: created.id } : {}) };
  }

  async testIndexer(id: number): Promise<{ success: boolean; message: string }> {
    const { url } = this.requireConfig();
    const getRes = await fetch(`${url}/api/v1/indexer/${id}`, { headers: this.headers(), signal: AbortSignal.timeout(6000) });
    if (!getRes.ok) return { success: false, message: 'Prowlarr could not find that indexer.' };
    const notAnswering = 'This source is not answering Prowlarr right now. It may be busy, down, or blocking Prowlarr. Try again later, or add another source.';
    let res: Response;
    try {
      // Prowlarr gives a site up to 100 seconds before it calls the test failed: wait for its verdict.
      res = await fetch(`${url}/api/v1/indexer/test`, { method: 'POST', headers: this.headers(), body: JSON.stringify(await getRes.json()), signal: AbortSignal.timeout(115000) });
    } catch {
      return { success: false, message: notAnswering };
    }
    if (res.ok) return { success: true, message: 'The source answered. Requests can search it now.' };
    const detail = await res.text().catch(() => '');
    const first = /"errorMessage"\s*:\s*"([^"]+)"/.exec(detail)?.[1] ?? '';
    if (/timed out|unavailable|unable to connect/i.test(first)) return { success: false, message: notAnswering };
    if (/captcha|cloudflare/i.test(first)) return { success: false, message: 'This source asks for a captcha, which Prowlarr cannot solve. Choose another source.' };
    if (/unauthori[sz]ed|login|credentials|api key/i.test(first)) return { success: false, message: 'This source needs a login or key. Add it in Prowlarr with your account details.' };
    return { success: false, message: first || `The test failed (status ${res.status}).` };
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

  /** Free-text release search across every source, for picking a download by hand. */
  async searchReleases(query: string): Promise<ProwlarrRelease[]> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/search?query=${encodeURIComponent(query)}&type=search&limit=100`, {
      headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(75_000)
    });
    if (!res.ok) throw new Error(`Prowlarr returned ${res.status} while searching.`);
    const data = (await res.json()) as Array<Record<string, unknown>>;
    return data.map(r => ({
      guid: String(r.guid ?? ''), title: String(r.title ?? ''), indexer: String(r.indexer ?? ''), indexerId: Number(r.indexerId ?? 0),
      size: Number(r.size ?? 0), seeders: Number(r.seeders ?? 0), leechers: Number(r.leechers ?? 0), ageDays: Number(r.age ?? 0),
      protocol: String(r.protocol ?? ''), downloadUrl: String(r.downloadUrl ?? r.magnetUrl ?? '')
    })).filter(r => r.guid && r.title);
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
