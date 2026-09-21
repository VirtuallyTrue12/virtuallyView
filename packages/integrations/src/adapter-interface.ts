import { Media, Download, IntegrationStatus } from '@virtuallyview/types';

export interface IntegrationAdapter<TConfig = unknown> {
  id: string;
  name: string;
  connect(config: TConfig): Promise<{ connected: boolean; message: string }>; 
  disconnect(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; status: string }>; 
  getStatus(): Promise<IntegrationStatus>;
  search(query: string): Promise<Media[]>;
  getItems(options?: { limit?: number; offset?: number }): Promise<Media[]>;
  getItem(id: string): Promise<Media | null>;
  add(mediaRequest: { title: string; type: string; qualityProfile?: string }): Promise<{ success: boolean; message: string }>;
  remove(mediaId: string): Promise<{ success: boolean; message: string }>;
  getQueue(): Promise<Download[]>;
  refreshMetadata(mediaId: string): Promise<{ success: boolean; message: string }>;
  getHistory(): Promise<{ events: { timestamp: Date; service: string; message: string }[] }>;
}

// Real reachability check used by health checks. Treats any genuine HTTP
// response (200 through 499, e.g. an auth prompt) as the service being live;
// connection failures and timeouts mean the service is offline.
export async function pingService(baseUrl: string, timeoutMs = 2500): Promise<{ healthy: boolean; status: string }> {
  try {
    const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const up = res.status >= 200 && res.status < 500;
    return up ? { healthy: true, status: 'online' } : { healthy: false, status: 'offline' };
  } catch {
    return { healthy: false, status: 'offline' };
  }
}
