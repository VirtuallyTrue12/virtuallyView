import { existsSync, readFileSync } from 'node:fs';

// Start and stop the stack's containers by asking the optional host helper
// (scripts/host-helper.mjs). The dashboard itself never has Docker access.

const URL_BASE = process.env.VV_HELPER_URL ?? 'http://helper:8099';
const TOKEN_FILE = process.env.VV_HELPER_TOKEN_FILE ?? '/shared/token';
export const HELPER_HINT = 'Service controls need the helper: run "docker compose --profile helper up -d" on the server. It is optional, and it is the only part with container access.';

export interface HelperResult<T> { ok: boolean; message?: string; data?: T }

async function call<T>(method: 'GET' | 'POST', path: string): Promise<HelperResult<T>> {
  if (!existsSync(TOKEN_FILE)) return { ok: false, message: HELPER_HINT };
  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      method, headers: { Authorization: `Bearer ${readFileSync(TOKEN_FILE, 'utf8').trim()}` }, signal: AbortSignal.timeout(20000)
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    return res.ok ? { ok: true, data } : { ok: false, message: (data as { message?: string }).message ?? `The helper answered ${res.status}.` };
  } catch {
    return { ok: false, message: HELPER_HINT };
  }
}

export const helperStatus = () => call<{ services: Array<{ service: string; state: string; status: string }> }>('GET', '/status');
export const helperAction = (service: string, action: 'start' | 'stop' | 'restart') => call<{ ok: boolean }>('POST', `/service/${encodeURIComponent(service)}/${action}`);
export const helperStartAll = () => call<{ started: string[] }>('POST', '/start-all');
