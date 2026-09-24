import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The one version number: the root package.json (the image, tag, health check, About page and update check all read this). */
function readVersion(): string {
  if (process.env.VV_VERSION) return process.env.VV_VERSION;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const file = resolve(dir, 'package.json');
    if (existsSync(file)) {
      try {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === 'virtuallyview' && pkg.version) return pkg.version;
      } catch { /* keep looking upward */ }
    }
    dir = dirname(dir);
  }
  return '0.0.0';
}

export const VERSION = readVersion();
