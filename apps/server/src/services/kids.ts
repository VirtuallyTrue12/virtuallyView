// Kids profiles: what a Kids profile is not allowed to reach on the server.
// The web app also hides these pages, but the server is what actually enforces it.

/** Pages and APIs for requests, downloads, settings, apps and diagnostics. Every method is refused for a Kids profile. */
const KIDS_BLOCKED = [
  '/api/requests', '/api/downloads', '/api/diagnostics', '/api/apps', '/api/troubleshoot',
  '/api/settings', '/api/server-settings', '/api/integrations', '/api/services', '/api/onboarding',
  '/api/setup', '/api/system', '/api/indexers', '/api/backup', '/api/kiwix/config', '/api/library'
];

/** Starting a search, a specials lookup or a file replacement for a title (this is how a download is asked for). */
const KIDS_BLOCKED_ACTION = /^\/api\/(movies|series|artists)\/[^/]+\/(search|specials|replace-file)$/;

/** True when a Kids profile must be refused this request. Other profiles are never affected. */
export function kidsBlocked(isKid: boolean, method: string, path: string): boolean {
  if (!isKid) return false;
  if (KIDS_BLOCKED.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return true;
  return method !== 'GET' && method !== 'HEAD' && KIDS_BLOCKED_ACTION.test(path);
}
