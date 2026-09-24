import { readFileSync } from 'node:fs';
import { notify } from './notifications.js';

/**
 * Keeps the bundled apps current without waiting for Watchtower's own timer.
 * As soon as the internet is reachable (at start, or after it comes back) the
 * download and search apps go first, then everything else. Only active when
 * the optional `auto-update` profile (Watchtower) is running.
 */

/** Pulled and restarted before anything else: the apps that fetch and search for media. */
export const PRIORITY_IMAGES = [
  'lscr.io/linuxserver/prowlarr', 'lscr.io/linuxserver/radarr', 'lscr.io/linuxserver/sonarr', 'lscr.io/linuxserver/lidarr',
  'lscr.io/linuxserver/bazarr', 'ghcr.io/flaresolverr/flaresolverr', 'lscr.io/linuxserver/qbittorrent'
];

const CHECK_EVERY_MS = 60_000;
const RECHECK_UPDATES_MS = 6 * 3_600_000;
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
const ABSENT_RETRY_MS = 3_600_000;

interface Summary { updated: number; failed: number }
type Fetch = typeof fetch;

export interface AutoUpdateDeps {
  fetchImpl?: Fetch;
  now?: () => number;
  url?: string | undefined;
  token?: string | undefined;
  priority?: string[];
  onUpdated?: (summary: Summary) => void;
}

function readToken(): string | undefined {
  const file = process.env.WATCHTOWER_TOKEN_FILE;
  try { if (file) return readFileSync(file, 'utf8').trim() || undefined; } catch { /* not created yet */ }
  return process.env.WATCHTOWER_TOKEN || undefined;
}

export async function internetReachable(fetchImpl: Fetch = fetch): Promise<boolean> {
  // Any HTTP answer (even 401) proves the internet is up; only a network failure means it is not.
  for (const url of ['https://ghcr.io/v2/', 'https://registry-1.docker.io/v2/']) {
    try { await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) }); return true; } catch { /* try the next one */ }
  }
  return false;
}

/** Is Watchtower there at all? Any HTTP answer (even "not allowed") says yes; no answer says the profile is off. */
export async function watchtowerPresent(deps: AutoUpdateDeps): Promise<boolean> {
  const base = deps.url ?? process.env.WATCHTOWER_URL;
  if (!base) return false;
  try { await (deps.fetchImpl ?? fetch)(`${base.replace(/\/$/, '')}/v1/update`, { method: 'GET', signal: AbortSignal.timeout(3000) }); return true; } catch { return false; }
}

/** One trigger call to Watchtower. Returns null when Watchtower is not there, a summary when it ran. */
export async function triggerUpdate(deps: AutoUpdateDeps, images?: string[]): Promise<Summary | null> {
  const base = deps.url ?? process.env.WATCHTOWER_URL;
  const token = deps.token ?? readToken();
  if (!base || !token) return null;
  const query = images?.length ? `?image=${encodeURIComponent(images.join(','))}` : '';
  const response = await (deps.fetchImpl ?? fetch)(`${base.replace(/\/$/, '')}/v1/update${query}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15 * 60_000)
  });
  if (!response.ok) throw new Error(`Watchtower answered ${response.status}`);
  const body = await response.json().catch(() => ({})) as { summary?: Partial<Summary> };
  return { updated: body.summary?.updated ?? 0, failed: body.summary?.failed ?? 0 };
}

/** Priority apps first, then the rest. */
export async function runUpdates(deps: AutoUpdateDeps): Promise<Summary | null> {
  const first = await triggerUpdate(deps, deps.priority ?? PRIORITY_IMAGES);
  if (!first) return null;
  const rest = await triggerUpdate(deps);
  return { updated: first.updated + (rest?.updated ?? 0), failed: first.failed + (rest?.failed ?? 0) };
}

export function startAutoUpdate(deps: AutoUpdateDeps = {}): void {
  if (!(deps.url ?? process.env.WATCHTOWER_URL)) return;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  let wasOnline = false;
  let lastRun = 0;
  let pausedUntil = 0;
  let running = false;

  const tick = async () => {
    if (running || now() < pausedUntil) return;
    // Nothing leaves the machine unless the opt-in updater is actually running.
    if (!(await watchtowerPresent(deps))) { pausedUntil = now() + ABSENT_RETRY_MS; wasOnline = false; return; }
    const online = await internetReachable(fetchImpl);
    const justConnected = online && !wasOnline;
    wasOnline = online;
    if (!online) return;
    if (!justConnected && now() - lastRun < RECHECK_UPDATES_MS) return;
    running = true;
    try {
      const summary = await runUpdates(deps);
      if (!summary) { pausedUntil = now() + ABSENT_RETRY_MS; wasOnline = false; return; }
      lastRun = now();
      if (summary.updated > 0) {
        deps.onUpdated?.(summary);
        notify({ type: 'system.updated', role: 'admin', title: 'Apps were updated', body: `${summary.updated} app${summary.updated === 1 ? '' : 's'} updated to the latest version${summary.failed ? `, ${summary.failed} could not be updated` : ''}.` });
      }
    } catch {
      pausedUntil = now() + RETRY_AFTER_FAILURE_MS;
      wasOnline = false; // try again as if the connection had just come back
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 20_000).unref();
  setInterval(() => void tick(), CHECK_EVERY_MS).unref();
}
