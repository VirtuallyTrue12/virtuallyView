import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { DATA_DIR } from '../lib/paths.js';
import { booksRoot, inside, listFolder, photosRoot } from '../services/library-folders.js';
import { resolveBinary } from '../services/transcode.js';

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

  server.get<{ Querystring: { path?: string } }>('/api/photos/file', async (request, reply) => {
    const file = inside(photosRoot(), request.query.path ?? '');
    if (!file || !PHOTO.test(file) || !statSync(file).isFile()) return reply.code(404).send({ message: 'Photo not found.' });
    return reply.header('Content-Type', MIME[extOf(file)] ?? 'application/octet-stream').header('Cache-Control', 'private, max-age=86400').send(createReadStream(file));
  });

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
