import type { FastifyInstance } from 'fastify';
import { findUnmapped, importFolders, type ImportKind } from '../services/import-existing.js';
import { mediaFolderInfo, type FolderKind } from '../services/media-folders.js';

const KINDS = new Set(['movies', 'series', 'artists']);
const FOLDER_KINDS = new Set(['movies', 'tv', 'music', 'photos', 'books']);

/** Administrators only (see ADMIN_ONLY_READ and the /api/library write rule in index.ts). */
export default async function importExistingRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { kind?: string } }>('/api/library/unmapped', async (request, reply) => {
    const kind = request.query.kind ?? '';
    if (!KINDS.has(kind)) return reply.code(400).send({ message: 'Choose movies, series or artists.' });
    try { return { items: await findUnmapped(kind as ImportKind) }; }
    catch (error) { return reply.code(502).send({ message: error instanceof Error ? error.message : 'The media app could not be reached.' }); }
  });

  server.get<{ Querystring: { kind?: string } }>('/api/library/folders', async (request, reply) => {
    const kind = request.query.kind ?? '';
    if (!FOLDER_KINDS.has(kind)) return reply.code(400).send({ message: 'Choose movies, tv, music, photos or books.' });
    return mediaFolderInfo(kind as FolderKind);
  });

  server.post<{ Body: { kind?: string; items?: Array<{ path?: string; providerId?: string; title?: string; year?: number }> } }>('/api/library/import', async (request, reply) => {
    const kind = request.body?.kind ?? '';
    if (!KINDS.has(kind)) return reply.code(400).send({ message: 'Choose movies, series or artists.' });
    const items = (request.body?.items ?? []).filter((i): i is { path: string; providerId: string; title: string; year?: number } => typeof i.path === 'string' && typeof i.providerId === 'string' && typeof i.title === 'string');
    if (!items.length) return reply.code(400).send({ message: 'Choose at least one folder to import.' });
    return { results: await importFolders(kind as ImportKind, items) };
  });
}
