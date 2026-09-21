import { realpathSync } from 'node:fs';
import path from 'node:path';
import { getServerSettings } from './server-settings.js';

/**
 * Effective media roots a stream may serve from. The MEDIA_ROOTS environment
 * variable overrides everything when set (container/remote setups); otherwise
 * the folders saved in server settings are used, falling back to the defaults.
 * Computed per call so saved folder changes apply without a server restart.
 */
export function getMediaRoots(): string[] {
  const env = process.env.MEDIA_ROOTS;
  if (env) {
    return env.split(',').map(root => path.resolve(root.trim())).filter(Boolean);
  }
  const saved = getServerSettings().mediaRoots;
  const roots = [saved.movies, saved.tv, saved.music]
    .filter(Boolean)
    .map(root => path.resolve(root.trim()));
  return roots.length ? roots : ['/media/movies', '/media/tv', '/media/music'];
}

/** True when a real path sits inside one of the configured media roots. */
export function isAllowedMediaFile(filePath: string): boolean {
  try {
    const resolved = realpathSync(filePath);
    return getMediaRoots().some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  } catch {
    return false;
  }
}
