import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pingService } from '@virtuallyview/integrations';
import { DATA_DIR } from '../lib/paths.js';

// Other self-hosted apps you already run, shown next to your media: connect
// by address (plus an optional key for a headline number). Nothing is
// bundled or provisioned, and each app keeps its own interface - this links
// to it and reports whether it is answering.

interface KnownApp { id: string; name: string; what: string; ping: string; keyHelp: string; bundledUrl: string; port: number; install: string }

export const KNOWN_APPS: KnownApp[] = [
  { id: 'immich', name: 'Immich', what: 'Photos and videos with search', ping: '/api/server/ping', bundledUrl: 'http://immich-server:2283', port: 2283, install: 'docker compose --profile immich up -d', keyHelp: 'An API key from Immich > Account Settings > API Keys (optional, shows photo and video counts).' },
  { id: 'audiobookshelf', name: 'Audiobookshelf', what: 'Audiobooks and podcasts', ping: '/ping', bundledUrl: 'http://audiobookshelf:80', port: 13378, install: 'docker compose --profile audiobookshelf up -d', keyHelp: 'An API token from Audiobookshelf > Settings > Users > your user (optional, shows library count).' },
  { id: 'kavita', name: 'Kavita', what: 'Ebooks, manga and comics', ping: '/api/health', bundledUrl: 'http://kavita:5000', port: 5000, install: 'docker compose --profile kavita up -d', keyHelp: 'Kavita needs no key here; this only checks that it is answering.' }
];

interface Saved { url: string; apiKey?: string; dismissed?: boolean }
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
  if (!url.trim()) { all[id] = { url: '', dismissed: true }; save(all); return { ok: true }; }
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

export interface AppStatus { id: string; name: string; what: string; keyHelp: string; install: string; port: number; bundled?: boolean; connected: boolean; url: string | null; healthy: boolean; hasKey: boolean; headline?: string }

export async function listApps(): Promise<AppStatus[]> {
  const all = load();
  return Promise.all(KNOWN_APPS.map(async app => {
    let s: Saved | undefined = all[app.id]?.url ? all[app.id] : undefined;
    const base = { id: app.id, name: app.name, what: app.what, keyHelp: app.keyHelp, install: app.install, port: app.port };
    // Started with the bundled compose profile? Connect it without asking,
    // unless the person disconnected it on purpose.
    let bundled = false;
    if (!s && !all[app.id]?.dismissed && (await pingService(`${app.bundledUrl}${app.ping}`, 1500)).healthy) {
      all[app.id] = { url: app.bundledUrl };
      save(all);
      s = all[app.id];
    }
    if (s) bundled = s.url === app.bundledUrl;
    if (!s) return { ...base, connected: false, url: null, healthy: false, hasKey: false };
    const { healthy } = await pingService(`${s.url}${app.ping}`, 3000);
    const line = healthy ? await headline(app.id, s) : undefined;
    return { ...base, connected: true, bundled, url: s.url, healthy, hasKey: !!s.apiKey, ...(line ? { headline: line } : {}) };
  }));
}
