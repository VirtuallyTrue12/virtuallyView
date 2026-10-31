import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadServiceConfig } from './registry.js';

const run = promisify(execFile);

/**
 * Some releases (music from Internet Archive, older movie packs) arrive as one .zip. Radarr, Sonarr and Lidarr do
 * not unpack archives: they park the download with "Found archive file, might need to be extracted" and wait for
 * a person for ever. This unpacks it next to the archive and asks the app to import that folder.
 */

const DOWNLOADS = process.env.VV_DOWNLOADS_DIR ?? '/downloads';
const APPS = [
  { key: 'radarr', version: 'v3', scan: 'DownloadedMoviesScan' },
  { key: 'sonarr', version: 'v3', scan: 'DownloadedEpisodesScan' },
  { key: 'lidarr', version: 'v1', scan: 'DownloadedAlbumsScan' }
] as const;
const ARCHIVE_RE = /\.(zip|tar|tar\.gz|tgz)$/i;
const done = new Set<string>();

/** The folder the archive lies in, only when it is inside the downloads folder (never anywhere else). */
export function safeFolder(outputPath: string | undefined, root = DOWNLOADS): string | null {
  if (!outputPath) return null;
  const resolved = path.resolve(outputPath);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

async function unpack(folder: string): Promise<boolean> {
  const archives = readdirSync(folder).filter(f => ARCHIVE_RE.test(f) && statSync(path.join(folder, f)).isFile());
  if (!archives.length) return false;
  for (const name of archives) {
    const file = path.join(folder, name);
    // -n: never overwrite; unzip and tar both refuse paths that climb out of the folder.
    if (/\.zip$/i.test(name)) await run('unzip', ['-n', '-qq', file, '-d', folder], { timeout: 10 * 60_000 });
    else await run('tar', ['-xf', file, '-C', folder, '--no-same-owner'], { timeout: 10 * 60_000 });
  }
  return true;
}

/** One pass: unpack every queued download an app reports as an archive, then ask that app to import it. */
export async function unpackArchives(): Promise<string[]> {
  if (!existsSync(DOWNLOADS)) return [];
  const configs = loadServiceConfig();
  const unpacked: string[] = [];
  for (const app of APPS) {
    const config = configs[app.key];
    if (!config || config.enabled === false || !config.url || !config.apiKey) continue;
    let records: Array<{ title?: string; outputPath?: string; statusMessages?: Array<{ title?: string; messages?: string[] }> }> = [];
    try {
      const res = await fetch(`${config.url}/api/${app.version}/queue?pageSize=200`, { headers: { 'X-Api-Key': config.apiKey }, signal: AbortSignal.timeout(8000) });
      if (res.ok) records = ((await res.json()) as { records?: typeof records }).records ?? [];
    } catch { continue; }
    for (const r of records) {
      const text = JSON.stringify(r.statusMessages ?? []);
      if (!/archive file/i.test(text)) continue;
      const folder = safeFolder(r.outputPath);
      if (!folder || done.has(folder) || !existsSync(folder) || !statSync(folder).isDirectory()) continue;
      try {
        if (!(await unpack(folder))) continue;
        done.add(folder);
        // Map the app's view of the folder (its own /downloads) - the same volume, the same path.
        await fetch(`${config.url}/api/${app.version}/command`, {
          method: 'POST', headers: { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: app.scan, path: r.outputPath, importMode: 'Move' }), signal: AbortSignal.timeout(8000)
        });
        unpacked.push(r.title ?? path.basename(folder));
      } catch { /* a broken archive stays as it is; the doctor replaces the release later */ }
    }
  }
  return unpacked;
}
