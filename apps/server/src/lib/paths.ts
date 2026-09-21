import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * apps/server/data, resolved relative to this module rather than
 * process.cwd() - which npm sets to the workspace directory (apps/server)
 * when run as `npm run dev --workspace=apps/server`, not the repo root.
 * A cwd-relative path would silently double up and never be found.
 * VV_DATA_DIR overrides the location (used by the end-to-end tests
 * so they run against an isolated scratch directory, never the live store).
 */
export const DATA_DIR = process.env.VV_DATA_DIR
  ? resolve(process.env.VV_DATA_DIR)
  : resolve(here, '../../data');

/** Repository root, resolved the same cwd-independent way. */
export const REPO_ROOT = resolve(here, '../../../..');

export const THEMES_DIR = resolve(REPO_ROOT, 'themes');

/** The built web app (apps/web/dist), served as static files in production. */
export const WEB_DIST_DIR = resolve(REPO_ROOT, 'apps/web/dist');
