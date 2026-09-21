import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ART_HOST } from '@virtuallyview/integrations';
import type { LidarrAdapter } from '@virtuallyview/integrations';
import { DATA_DIR } from '../lib/paths.js';
import { getAdapter } from '../services/registry.js';
import { outboundFetch } from '../services/outbound.js';

const MAX_BYTES = 6 * 1024 * 1024;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Cover art for music, fetched here so every device sees it and third-party sites only see the server. */
export default async function artRoutes(server: FastifyInstance) {
  const dir = resolve(DATA_DIR, 'art');

  server.get<{ Querystring: { u?: string } }>('/api/art', async (request, reply) => {
    const target = request.query.u ?? '';
    const local = /^lidarr:(\/MediaCover\/[\w./-]+)$/.exec(target)?.[1];
    let remote: URL | null = null;
    if (!local) {
      try { remote = new URL(target); } catch { remote = null; }
      if (!remote || remote.protocol !== 'https:' || !ART_HOST.test(remote.hostname)) return reply.code(400).send({ message: 'That image cannot be loaded here.' });
    }
    const key = createHash('sha1').update(target).digest('hex');
    const body = resolve(dir, `${key}.bin`);
    const kind = resolve(dir, `${key}.type`);
    if (existsSync(body) && existsSync(kind) && Date.now() - Date.parse(readFileSync(resolve(dir, `${key}.at`), 'utf8')) < TTL_MS) {
      return reply.header('Content-Type', readFileSync(kind, 'utf8')).header('Cache-Control', 'private, max-age=86400').send(readFileSync(body));
    }
    try {
      const res = local ? await getAdapter<LidarrAdapter>('lidarr').fetchMediaCover(local) : await outboundFetch(remote!.toString(), { timeoutMs: 12_000 });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !/^image\//i.test(type)) return reply.code(404).send({ message: 'No image.' });
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > MAX_BYTES) return reply.code(413).send({ message: 'Image too large.' });
      mkdirSync(dir, { recursive: true });
      writeFileSync(body, data);
      writeFileSync(kind, type);
      writeFileSync(resolve(dir, `${key}.at`), new Date().toISOString());
      return reply.header('Content-Type', type).header('Cache-Control', 'private, max-age=86400').send(data);
    } catch {
      return reply.code(502).send({ message: 'The image source could not be reached.' });
    }
  });
}
