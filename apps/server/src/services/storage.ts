import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { getServerSettings } from './server-settings.js';

export interface RootUsage {
  name: string;
  path: string;
  exists: boolean;
  bytes: number;
  files: number;
}

export interface StorageReport {
  roots: RootUsage[];
  mediaBytes: number;
  mediaFiles: number;
  disk: { totalBytes: number; freeBytes: number; usedBytes: number } | null;
  truncated: boolean;
  computedAt: string;
}

const CACHE_TTL_MS = 60_000;
const SCAN_BUDGET_MS = 8000;
const MAX_ENTRIES = 250_000;

let cache: { at: number; value: StorageReport } | null = null;

function labeledRoots(): Array<{ name: string; root: string }> {
  const env = process.env.MEDIA_ROOTS;
  if (env) {
    return env
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map((value, index) => ({ name: `Root ${index + 1}`, root: path.resolve(value) }));
  }
  const media = getServerSettings().mediaRoots;
  return [
    { name: 'Movies', root: media.movies || '/media/movies' },
    { name: 'TV', root: media.tv || '/media/tv' },
    { name: 'Music', root: media.music || '/media/music' }
  ].map(entry => ({ ...entry, root: path.resolve(entry.root) }));
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Total size and file count under one root. Bounded by a time budget and an
 * entry cap so a huge or network-mounted library can never block the request
 * indefinitely; a partial result is reported via `truncated`.
 */
async function measureRoot(root: string): Promise<{ bytes: number; files: number; truncated: boolean }> {
  const deadline = Date.now() + SCAN_BUDGET_MS;
  let bytes = 0;
  let files = 0;
  let entries = 0;
  let truncated = false;
  const stack: string[] = [root];

  while (stack.length) {
    if (Date.now() > deadline || entries > MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const current = stack.pop()!;
    let dirents;
    try {
      dirents = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    const subdirs: string[] = [];
    const filePaths: string[] = [];
    for (const dirent of dirents) {
      entries++;
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) subdirs.push(full);
      else if (dirent.isFile()) filePaths.push(full);
      // Symlinks are skipped: they can loop, and the real target is counted
      // through its own directory when it lives under a media root.
    }
    // Resolve file sizes with a small amount of concurrency.
    for (let i = 0; i < filePaths.length; i += 64) {
      const batch = filePaths.slice(i, i + 64);
      const sizes = await Promise.all(batch.map(async file => {
        try {
          return (await stat(file)).size;
        } catch {
          return 0;
        }
      }));
      for (const size of sizes) {
        bytes += size;
        files++;
      }
    }
    for (const dir of subdirs) stack.push(dir);
  }

  return { bytes, files, truncated };
}

export async function getStorageReport(): Promise<StorageReport> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const roots = labeledRoots();
  const usages: RootUsage[] = [];
  let truncated = false;

  for (const entry of roots) {
    if (!(await directoryExists(entry.root))) {
      usages.push({ name: entry.name, path: entry.root, exists: false, bytes: 0, files: 0 });
      continue;
    }
    const measured = await measureRoot(entry.root);
    truncated = truncated || measured.truncated;
    usages.push({ name: entry.name, path: entry.root, exists: true, bytes: measured.bytes, files: measured.files });
  }

  let disk: StorageReport['disk'] = null;
  for (const entry of roots) {
    try {
      const info = await statfs(entry.root);
      const totalBytes = Number(info.bsize) * Number(info.blocks);
      const freeBytes = Number(info.bsize) * Number(info.bavail);
      disk = { totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) };
      break;
    } catch {
      // Root missing or unsupported filesystem; try the next one.
    }
  }

  const value: StorageReport = {
    roots: usages,
    mediaBytes: usages.reduce((sum, usage) => sum + usage.bytes, 0),
    mediaFiles: usages.reduce((sum, usage) => sum + usage.files, 0),
    disk,
    truncated,
    computedAt: new Date().toISOString()
  };
  cache = { at: Date.now(), value };
  return value;
}
