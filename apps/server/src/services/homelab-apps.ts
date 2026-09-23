import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pingService } from '@virtuallyview/integrations';
import { DATA_DIR } from '../lib/paths.js';

// Other self-hosted apps you already run, shown next to your media: connect
// by address (plus an optional key for a headline number). Nothing is
// bundled or provisioned, and each app keeps its own interface - this links
// to it and reports whether it is answering.

interface KnownApp { id: string; name: string; what: string; ping: string; keyHelp: string }

export const KNOWN_APPS: KnownApp[] = [
  { id: 'immich', name: 'Immich', what: 'Photos and videos with search', ping: '/api/server/ping', keyHelp: 'An API key from Immich > Account Settings > API Keys (optional, shows photo and video counts).' },
  { id: 'audiobookshelf', name: 'Audiobookshelf', what: 'Audiobooks and podcasts', ping: '/ping', keyHelp: 'An API token from Audiobookshelf > Settings > Users > your user (optional, shows library count).' },
  { id: 'kavita', name: 'Kavita', what: 'Ebooks, manga and comics', ping: '/api/health', keyHelp: 'Kavita needs no key here; this only checks that it is answering.' }
];

interface Saved { url: string; apiKey?: string }
const FILE = resolve(DATA_DIR, 'homelab-apps.json');

function load(): Record<string, Saved> {
  try { return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, Saved>) : {}; } catch { return {}; }
}
function save(all: Record<string, Saved>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(all), { encoding: 'utf8', mode: 0o600 });
}

export function saveApp(id: string, url: string, apiKey?: string): { ok: true } | { ok: false; message: string } {
  if (!KNOWN_APPS.some(a => a.id === id)) return { ok: false, message: 'Unknown app.' };
  const all = load();
  if (!url.trim()) { delete all[id]; save(all); return { ok: true }; }
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return { ok: false, message: 'Enter a full address starting with http:// or https://.' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, message: 'Only http and https addresses are supported.' };
  all[id] = { url: url.trim().replace(/\/$/, ''), ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}) };
  save(all);
  return { ok: true };
}

async function headline(id: string, s: Saved): Promise<string | undefined> {
  if (!s.apiKey) return undefined;
  try {
    if (id === 'immich') {
      const r = await fetch(`${s.url}/api/server/statistics`, { headers: { 'x-api-key': s.apiKey }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) return undefined;
      const j = (await r.json()) as { photos?: number; videos?: number };
      return `${j.photos ?? 0} photos, ${j.videos ?? 0} videos`;
    }
    if (id === 'audiobookshelf') {
      const r = await fetch(`${s.url}/api/libraries`, { headers: { Authorization: `Bearer ${s.apiKey}` }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) return undefined;
      const j = (await r.json()) as { libraries?: unknown[] };
      return `${j.libraries?.length ?? 0} libraries`;
    }
  } catch { /* the headline is a bonus; the health check is the point */ }
  return undefined;
}

export interface AppStatus { id: string; name: string; what: string; keyHelp: string; connected: boolean; url: string | null; healthy: boolean; hasKey: boolean; headline?: string }

export async function listApps(): Promise<AppStatus[]> {
  const all = load();
  return Promise.all(KNOWN_APPS.map(async app => {
    const s = all[app.id];
    const base = { id: app.id, name: app.name, what: app.what, keyHelp: app.keyHelp };
    if (!s) return { ...base, connected: false, url: null, healthy: false, hasKey: false };
    const { healthy } = await pingService(`${s.url}${app.ping}`, 3000);
    const line = healthy ? await headline(app.id, s) : undefined;
    return { ...base, connected: true, url: s.url, healthy, hasKey: !!s.apiKey, ...(line ? { headline: line } : {}) };
  }));
}
