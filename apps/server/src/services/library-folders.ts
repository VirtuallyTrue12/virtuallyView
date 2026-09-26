import { readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const photosRoot = () => path.resolve(process.env.VV_PHOTOS_DIR ?? '/media/photos');
export const booksRoot = () => path.resolve(process.env.VV_BOOKS_DIR ?? '/media/books');

/** Resolve a relative path inside a root, or null when it escapes (dots, links, absolute paths). */
export function inside(root: string, relative: string): string | null {
  if (relative.includes('\0')) return null;
  try {
    const real = realpathSync(path.resolve(root, relative.replace(/^\/+/, '')));
    const base = realpathSync(root);
    return real === base || real.startsWith(`${base}${path.sep}`) ? real : null;
  } catch {
    return null;
  }
}

export interface Listing { path: string; folders: string[]; files: Array<{ name: string; size: number; modified?: number }> }

/** One folder level: sub-folders and the files whose extension is allowed. */
export function listFolder(root: string, relative: string, extensions: RegExp): Listing | null {
  const dir = inside(root, relative);
  if (!dir || !statSync(dir).isDirectory()) return null;
  const folders: string[] = [];
  const files: Listing['files'] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) folders.push(entry.name);
    else if (extensions.test(entry.name)) {
      try { const st = statSync(path.join(dir, entry.name)); files.push({ name: entry.name, size: st.size, modified: Math.round(st.mtimeMs) }); } catch { /* vanished */ }
    }
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  folders.sort(collator.compare);
  files.sort((a, b) => collator.compare(a.name, b.name));
  return { path: path.relative(realpathSync(root), dir).split(path.sep).join('/'), folders, files: files.slice(0, 2000) };
}
