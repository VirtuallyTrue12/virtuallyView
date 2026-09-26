import { randomUUID } from 'node:crypto';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db/app-db.js';
import { currentUserId } from './user-context.js';
import { listFlagged, setFlags } from './user-flags.js';
import { booksRoot, inside, photosRoot } from './library-folders.js';

export const PHOTO_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

export interface PhotoEntry { path: string; name: string; size: number; modified: number }

const MAX_PHOTOS = 6000;
const MAX_DEPTH = 8;
let cache: { at: number; root: string; items: PhotoEntry[]; truncated: boolean } | null = null;

function walkFiles(root: string, re: RegExp, limit: number): { items: PhotoEntry[]; truncated: boolean } {
  const items: PhotoEntry[] = [];
  let truncated = false;
  let base: string;
  try { base = realpathSync(root); } catch { return { items, truncated }; }
  const walk = (dir: string, depth: number) => {
    if (truncated) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < MAX_DEPTH) walk(full, depth + 1); continue; }
      if (!entry.isFile() || !re.test(entry.name)) continue;
      if (items.length >= limit) { truncated = true; return; }
      try { const st = statSync(full); items.push({ path: path.relative(base, full).split(path.sep).join('/'), name: entry.name, size: st.size, modified: Math.round(st.mtimeMs) }); } catch { /* vanished */ }
    }
  };
  walk(base, 0);
  items.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
  return { items, truncated };
}

/** Every photo under the photos folder, newest first: the timeline. Kept for half a minute so scrolling stays fast. */
export function allPhotos(now = Date.now()): { items: PhotoEntry[]; truncated: boolean } {
  const root = photosRoot();
  if (cache && cache.root === root && now - cache.at < 30_000) return cache;
  cache = { at: now, root, ...walkFiles(root, PHOTO_RE, MAX_PHOTOS) };
  return cache;
}

export const BOOK_RE = /\.(pdf|epub|cbz|cbr|txt|mobi)$/i;
let bookCache: { at: number; root: string; items: PhotoEntry[]; truncated: boolean } | null = null;
/** Every book and comic, newest first, so the Books page can search the whole shelf. */
export function allBooks(now = Date.now()): { items: PhotoEntry[]; truncated: boolean } {
  const root = booksRoot();
  if (bookCache && bookCache.root === root && now - bookCache.at < 30_000) return bookCache;
  bookCache = { at: now, root, ...walkFiles(root, BOOK_RE, 6000) };
  return bookCache;
}
export function validBookPath(relative: unknown): string | null {
  if (typeof relative !== 'string' || relative.length > 500 || !BOOK_RE.test(relative)) return null;
  const file = inside(booksRoot(), relative);
  if (!file) return null;
  try { if (!statSync(file).isFile()) return null; } catch { return null; }
  return relative.replace(/^\/+/, '');
}
export const favoriteBooks = (): string[] => listFlagged('favorite').filter(f => f.mediaType === 'book').map(f => f.mediaId);
export const setBookFavorite = (relative: string, favorite: boolean): void => { setFlags('book', relative, { favorite }); };
export const resetPhotoCache = (): void => { cache = null; bookCache = null; };

/** A photo path from a client: only ones that exist inside the photos folder count. */
export function validPhotoPath(relative: unknown): string | null {
  if (typeof relative !== 'string' || relative.length > 500 || !PHOTO_RE.test(relative)) return null;
  const file = inside(photosRoot(), relative);
  if (!file) return null;
  try { if (!statSync(file).isFile()) return null; } catch { return null; }
  return relative.replace(/^\/+/, '');
}

// Favorites are per person and live in the same table as movie and show favorites.
export const favoritePhotos = (): string[] => listFlagged('favorite').filter(f => f.mediaType === 'photo').map(f => f.mediaId);
export const setPhotoFavorite = (relative: string, favorite: boolean): void => { setFlags('photo', relative, { favorite }); };

// Albums are per person too, and only list photos: nothing here writes to the photos folder, which is mounted read-only.
export interface PhotoAlbum { id: string; name: string; count: number; cover: string | null; updatedAt: string }
interface AlbumRow { id: string; user_id: string; name: string; paths: string; created_at: string; updated_at: string }
const parsePaths = (json: string): string[] => { try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []; } catch { return []; } };
const own = (id: string) => get<AlbumRow>('SELECT * FROM photo_albums WHERE id = ? AND user_id = ?', id, currentUserId());

export function listAlbums(): PhotoAlbum[] {
  return all<AlbumRow>('SELECT * FROM photo_albums WHERE user_id = ? ORDER BY updated_at DESC', currentUserId())
    .map(r => { const paths = parsePaths(r.paths); return { id: r.id, name: r.name, count: paths.length, cover: paths[0] ?? null, updatedAt: r.updated_at }; });
}
export function createAlbum(name: string): PhotoAlbum | null {
  const clean = name.trim().slice(0, 80);
  if (!clean) return null;
  const now = new Date().toISOString();
  const id = randomUUID();
  run('INSERT INTO photo_albums (id, user_id, name, paths, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, currentUserId(), clean, '[]', now, now);
  return { id, name: clean, count: 0, cover: null, updatedAt: now };
}
export function albumPhotos(id: string): { id: string; name: string; paths: string[] } | null {
  const row = own(id);
  return row ? { id: row.id, name: row.name, paths: parsePaths(row.paths) } : null;
}
export function changeAlbum(id: string, change: { name?: string; add?: string[]; remove?: string[] }): boolean {
  const row = own(id);
  if (!row) return false;
  let paths = parsePaths(row.paths);
  if (change.add) for (const p of change.add) if (!paths.includes(p)) paths.push(p);
  if (change.remove) { const drop = new Set(change.remove); paths = paths.filter(p => !drop.has(p)); }
  const name = change.name?.trim().slice(0, 80) || row.name;
  run('UPDATE photo_albums SET name = ?, paths = ?, updated_at = ? WHERE id = ?', name, JSON.stringify(paths), new Date().toISOString(), id);
  return true;
}
export function deleteAlbum(id: string): boolean {
  return Number(run('DELETE FROM photo_albums WHERE id = ? AND user_id = ?', id, currentUserId()).changes) > 0;
}
