import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { DATA_DIR } from '../lib/paths.js';
import { booksRoot, inside, listFolder, photosRoot } from '../services/library-folders.js';
import { resolveBinary } from '../services/transcode.js';
import { allBooks, favoriteBooks, setBookFavorite, validBookPath, albumPhotos, allPhotos, changeAlbum, createAlbum, deleteAlbum, favoritePhotos, listAlbums, setPhotoFavorite, validPhotoPath } from '../services/photos.js';

const PHOTO = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const BOOK = /\.(pdf|epub|cbz|cbr|txt|mobi)$/i;
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', pdf: 'application/pdf', epub: 'application/epub+zip', txt: 'text/plain; charset=utf-8', cbz: 'application/vnd.comicbook+zip', cbr: 'application/vnd.comicbook-rar', mobi: 'application/x-mobipocket-ebook' };
const extOf = (file: string) => file.split('.').pop()?.toLowerCase() ?? '';

/** Photos and books from folders you mount into the server. Read only. */
export default async function libraryFolderRoutes(server: FastifyInstance) {
  const thumbs = resolve(DATA_DIR, 'thumbs');
  // At most four previews are cut at once so a big folder cannot swamp the machine.
  let running = 0;
  const waiting: Array<() => void> = [];
  const slot = async () => { if (running >= 4) await new Promise<void>(go => waiting.push(go)); running++; };
  const free = () => { running--; waiting.shift()?.(); };

  server.get<{ Querystring: { dir?: string } }>('/api/photos', async (request, reply) => {
    const listing = listFolder(photosRoot(), request.query.dir ?? '', PHOTO);
    return listing ?? reply.code(404).send({ message: 'No photo folder here. Mount one at /media/photos (see the docs).' });
  });

  server.get<{ Querystring: { path?: string; download?: string } }>('/api/photos/file', async (request, reply) => {
    const file = inside(photosRoot(), request.query.path ?? '');
    if (!file || !PHOTO.test(file) || !statSync(file).isFile()) return reply.code(404).send({ message: 'Photo not found.' });
    const name = file.split('/').pop() ?? 'photo';
    if (request.query.download) reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.header('Content-Type', MIME[extOf(file)] ?? 'application/octet-stream').header('Cache-Control', 'private, max-age=86400').send(createReadStream(file));
  });

  // The whole collection, newest first, for the timeline and for searching by name.
  server.get('/api/photos/all', async () => { const { items, truncated } = allPhotos(); return { items, truncated }; });

  server.get('/api/photos/favorites', async () => {
    const known = new Set(allPhotos().items.map(p => p.path));
    return { paths: favoritePhotos().filter(p => known.has(p)) };
  });
  server.post<{ Body: { path?: string; favorite?: boolean } }>('/api/photos/favorite', async (request, reply) => {
    const rel = validPhotoPath(request.body?.path);
    if (!rel) return reply.code(404).send({ message: 'Photo not found.' });
    setPhotoFavorite(rel, request.body?.favorite !== false);
    return { ok: true };
  });

  server.get('/api/photo-albums', async () => ({ albums: listAlbums() }));
  server.post<{ Body: { name?: string; paths?: string[] } }>('/api/photo-albums', async (request, reply) => {
    const album = createAlbum(String(request.body?.name ?? ''));
    if (!album) return reply.code(400).send({ message: 'Give the album a name.' });
    const paths = (request.body?.paths ?? []).map(validPhotoPath).filter((p): p is string => !!p);
    if (paths.length) changeAlbum(album.id, { add: paths });
    return { ...album, count: paths.length, cover: paths[0] ?? null };
  });
  server.get<{ Params: { id: string } }>('/api/photo-albums/:id', async (request, reply) => {
    const album = albumPhotos(request.params.id);
    if (!album) return reply.code(404).send({ message: 'Album not found.' });
    const known = new Map(allPhotos().items.map(p => [p.path, p]));
    return { id: album.id, name: album.name, photos: album.paths.map(p => known.get(p)).filter(Boolean) };
  });
  server.post<{ Params: { id: string }; Body: { name?: string; add?: string[]; remove?: string[] } }>('/api/photo-albums/:id', async (request, reply) => {
    const b = request.body ?? {};
    const ok = changeAlbum(request.params.id, {
      ...(typeof b.name === 'string' ? { name: b.name } : {}),
      ...(Array.isArray(b.add) ? { add: b.add.map(validPhotoPath).filter((p): p is string => !!p) } : {}),
      ...(Array.isArray(b.remove) ? { remove: b.remove.filter((p): p is string => typeof p === 'string') } : {})
    });
    return ok ? { ok: true } : reply.code(404).send({ message: 'Album not found.' });
  });
  server.delete<{ Params: { id: string } }>('/api/photo-albums/:id', async (request, reply) => (deleteAlbum(request.params.id) ? { ok: true } : reply.code(404).send({ message: 'Album not found.' })));

  // Small previews made once with ffmpeg and kept in the data folder.
  server.get<{ Querystring: { path?: string } }>('/api/photos/thumb', async (request, reply) => {
    const file = inside(photosRoot(), request.query.path ?? '');
    if (!file || !PHOTO.test(file) || !statSync(file).isFile()) return reply.code(404).send({ message: 'Photo not found.' });
    const ffmpeg = resolveBinary('ffmpeg');
    if (!ffmpeg) return reply.header('Content-Type', MIME[extOf(file)] ?? 'image/jpeg').send(createReadStream(file));
    mkdirSync(thumbs, { recursive: true });
    const key = Buffer.from(`${file}:${statSync(file).mtimeMs}`).toString('base64url').slice(-60);
    const cached = resolve(thumbs, `${key}.jpg`);
    if (!existsSync(cached)) {
      await slot();
      await new Promise<void>(done => {
        const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', file, '-vf', 'scale=420:-2', '-frames:v', '1', '-q:v', '5', cached], { stdio: 'ignore' });
        child.on('close', () => done());
        child.on('error', () => done());
      }).finally(free);
    }
    if (!existsSync(cached)) return reply.header('Content-Type', MIME[extOf(file)] ?? 'image/jpeg').send(createReadStream(file));
    return reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=86400').send(createReadStream(cached));
  });

  server.get<{ Querystring: { dir?: string } }>('/api/books', async (request, reply) => {
    const listing = listFolder(booksRoot(), request.query.dir ?? '', BOOK);
    return listing ?? reply.code(404).send({ message: 'No book folder here. Mount one at /media/books (see the docs).' });
  });

  server.get('/api/books/all', async () => { const { items, truncated } = allBooks(); return { items, truncated }; });
  server.get('/api/books/favorites', async () => {
    const known = new Set(allBooks().items.map(b => b.path));
    return { paths: favoriteBooks().filter(p => known.has(p)) };
  });
  server.post<{ Body: { path?: string; favorite?: boolean } }>('/api/books/favorite', async (request, reply) => {
    const rel = validBookPath(request.body?.path);
    if (!rel) return reply.code(404).send({ message: 'Book not found.' });
    setBookFavorite(rel, request.body?.favorite !== false);
    return { ok: true };
  });

  server.get<{ Querystring: { path?: string } }>('/api/books/file', async (request, reply) => {
    const file = inside(booksRoot(), request.query.path ?? '');
    if (!file || !BOOK.test(file) || !statSync(file).isFile()) return reply.code(404).send({ message: 'Book not found.' });
    const name = file.split('/').pop() ?? 'book';
    return reply
      .header('Content-Type', MIME[extOf(file)] ?? 'application/octet-stream')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(createReadStream(file));
  });
}
