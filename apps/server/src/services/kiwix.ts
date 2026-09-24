import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pingService } from '@virtuallyview/integrations';
import { DATA_DIR } from '../lib/paths.js';

// Kiwix: a Kiwix server you already run elsewhere, or the bundled kiwix-serve
// container (docker compose --profile kiwix up -d). Either way this just
// stores its address; the reader itself is Kiwix's own web UI, embedded.

export interface KiwixConfig { url: string }

const FILE = resolve(DATA_DIR, 'kiwix.json');

export function loadKiwixConfig(): KiwixConfig | null {
  try {
    if (!existsSync(FILE)) return null;
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as KiwixConfig;
    return parsed.url ? parsed : null;
  } catch {
    return null;
  }
}

export function saveKiwixConfig(url: string): { ok: true; config: KiwixConfig } | { ok: false; message: string } {
  let parsedUrl: URL;
  try { parsedUrl = new URL(url); } catch { return { ok: false, message: 'Enter a full address starting with http:// or https://.' }; }
  if (!/^https?:$/.test(parsedUrl.protocol)) return { ok: false, message: 'Only http and https addresses are supported.' };
  const config: KiwixConfig = { url };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
  return { ok: true, config };
}

export function clearKiwixConfig(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify({ url: '' }), { encoding: 'utf8', mode: 0o600 });
}

export const BUNDLED_KIWIX = 'http://kiwix:8080';

export async function kiwixStatus(): Promise<{ configured: boolean; url: string | null; healthy: boolean; bundled?: boolean }> {
  let config = loadKiwixConfig();
  // The bundled container answering means nothing to type in.
  if (!config && !existsSync(FILE) && (await pingService(BUNDLED_KIWIX, 1500)).healthy) {
    saveKiwixConfig(BUNDLED_KIWIX);
    config = loadKiwixConfig();
  }
  if (!config) return { configured: false, url: null, healthy: false };
  const { healthy } = await pingService(config.url, 4000);
  return { configured: true, url: config.url, healthy, bundled: config.url === BUNDLED_KIWIX };
}
