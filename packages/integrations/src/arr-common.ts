import type { Download } from '@virtuallyview/types';
import { queueProblem } from './request-identity.js';

type ArrConfig = { url: string; apiKey: string };
type ArrApp = { service: 'radarr' | 'sonarr' | 'lidarr'; api: 'v3' | 'v1' };

const label = (service: string) => service[0].toUpperCase() + service.slice(1);

/** The app's download queue. `ownerKey` is the field naming the movie/series/artist, `extraKey` an optional episode/album id. */
export async function getArrQueue(config: ArrConfig, app: ArrApp, ownerKey: string, extraKey?: string): Promise<Download[]> {
  const { service, api } = app;
  const res = await fetch(`${config.url}/api/${api}/queue?pageSize=1000`, {
    headers: { 'X-Api-Key': config.apiKey },
    signal: AbortSignal.timeout(4000)
  });
  if (!res.ok) throw new Error(`${label(service)} returned ${res.status} while listing the queue.`);
  const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
  return (body.records ?? []).map(q => {
    const total = (Number(q.size) || 0) as number;
    const left = (Number(q.sizeleft ?? total) || 0) as number;
    const progress = total > 0
      ? Math.max(0, Math.min(100, Math.round(((total - left) / total) * 100)))
      : 0;
    const p = queueProblem(q);
    return {
      id: `queue-${String(q.id ?? '')}`,
      sourceClient: service,
      downloadId: typeof q.downloadId === 'string' ? q.downloadId : undefined,
      mediaId: q[ownerKey] ? `${service}-${String(q[ownerKey])}` : undefined,
      ...(extraKey && Number.isInteger(q[extraKey]) ? { [extraKey]: q[extraKey] as number } : {}),
      status: p.status ?? String((q.status ?? '') as string).toLowerCase(),
      ...(p.message ? { statusMessage: p.message } : {}),
      progress,
      title: (q.title as string) ?? 'Unknown download',
      size: total > 0 ? total : undefined,
      timeleft: (q.timeleft as string) ?? undefined
    } as Download & { title?: string; timeleft?: string };
  }) as Download[];
}

export async function removeArrQueueItem(config: ArrConfig, app: ArrApp, queueId: string, blocklist: boolean, timeoutMs = 4000): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${config.url}/api/${app.api}/queue/${queueId}?removeFromClient=true&blocklist=${blocklist}`, {
    method: 'DELETE',
    headers: { 'X-Api-Key': config.apiKey },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) return { success: false, message: `${label(app.service)} could not remove that queue item (status ${res.status}).` };
  return { success: true, message: 'Removed from the queue.' };
}

export async function getArrHistory(config: ArrConfig, app: ArrApp): Promise<{ events: { timestamp: Date; service: string; message: string }[] }> {
  const res = await fetch(`${config.url}/api/${app.api}/history?pageSize=50`, {
    headers: { 'X-Api-Key': config.apiKey },
    signal: AbortSignal.timeout(4000)
  });
  if (!res.ok) throw new Error(`${label(app.service)} returned ${res.status} while listing history.`);
  const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
  return {
    events: (body.records ?? []).map(r => ({
      timestamp: r.date ? new Date(r.date as string) : new Date(),
      service: app.service,
      message: `${(r.eventType as string) ?? 'event'}: ${(r.sourceTitle as string) ?? ''}`.trim()
    }))
  };
}
