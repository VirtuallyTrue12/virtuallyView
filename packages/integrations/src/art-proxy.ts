/** Hosts whose cover art the server may fetch on a viewer's behalf. */
export const ART_HOST = /^(images\.lidarr\.audio|coverartarchive\.org|(?:[\w-]+\.)?archive\.org|assets\.fanart\.tv|fanart\.tv|upload\.wikimedia\.org|image\.tmdb\.org|artworks\.thetvdb\.com|(?:[\w-]+\.)?dzcdn\.net|(?:[\w-]+\.)?mzstatic\.com|thumb\.wikimedia\.org|commons\.wikimedia\.org)$/i;

/**
 * Cover art goes through this server: the media manager's own copies are only
 * reachable from the server, and the public ones would otherwise be fetched by
 * every viewer's browser, which tells those sites who is looking.
 */
export function artProxyUrl(raw: string | undefined): string {
  if (!raw) return '';
  if (raw.startsWith('/')) return `/api/art?u=${encodeURIComponent(`lidarr:${raw.replace(/^\/config/, '').split('?')[0]}`)}`;
  try {
    if (ART_HOST.test(new URL(raw).hostname)) return `/api/art?u=${encodeURIComponent(raw)}`;
  } catch { /* not a URL: leave it */ }
  return raw;
}
