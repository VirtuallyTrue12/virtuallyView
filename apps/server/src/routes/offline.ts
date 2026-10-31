import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { parseByteRange } from '../lib/byte-range.js';
import { currentUserId } from '../services/user-context.js';
import {
  getOfflineJob, jobView, markFetched, prepareOfflineJob, readyFilePath, readyVttPath,
  type OfflineKind, type OfflineQuality
} from '../services/offline-jobs.js';

const KINDS = new Set<OfflineKind>(['movie', 'episode', 'track']);
const QUALITIES = new Set<OfflineQuality>(['standard', 'high']);
const JOB_ID_RE = /^[a-f0-9]{32}$/;

/** Downloads for offline use: start a conversion, poll it, then fetch the finished file. */
export default async function offlineRoutes(server: FastifyInstance) {
  server.post<{ Body: { kind?: string; id?: string; quality?: string; audio?: number } }>('/api/offline/prepare', async (request, reply) => {
    const body = request.body ?? {};
    if (!KINDS.has(body.kind as OfflineKind) || typeof body.id !== 'string' || body.id.length === 0 || body.id.length > 200) {
      return reply.code(400).send({ error: 'bad_request', message: 'Choose a movie, an episode or a song to save.' });
    }
    const quality = QUALITIES.has(body.quality as OfflineQuality) ? body.quality as OfflineQuality : 'standard';
    const result = await prepareOfflineJob(currentUserId(), {
      kind: body.kind as OfflineKind,
      id: body.id,
      quality,
      audio: Number.isInteger(body.audio) ? body.audio : undefined
    });
    if (!result.ok) return reply.code(result.status).send({ error: 'offline_unavailable', message: result.message });
    return jobView(result.job);
  });

  server.get<{ Params: { jobId: string } }>('/api/offline/jobs/:jobId', async (request, reply) => {
    const job = JOB_ID_RE.test(request.params.jobId) ? getOfflineJob(currentUserId(), request.params.jobId) : null;
    if (!job) return reply.code(404).send({ error: 'not_found', message: 'That download was not found. Start it again.' });
    return jobView(job);
  });

  server.get<{ Params: { jobId: string } }>('/api/offline/file/:jobId', async (request, reply) => {
    const job = JOB_ID_RE.test(request.params.jobId) ? getOfflineJob(currentUserId(), request.params.jobId) : null;
    const file = job ? readyFilePath(job) : null;
    if (!job || !file) return reply.code(404).send({ error: 'not_found', message: 'That download is not ready or has expired. Start it again.' });
    markFetched(job);
    const size = statSync(file).size;
    const mime = path.extname(file) === '.m4a' ? 'audio/mp4' : 'video/mp4';
    const common = (r: typeof reply) => r
      .header('Content-Type', mime)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'private, no-store')
      .header('Access-Control-Allow-Origin', '*');
    const range = request.headers.range;
    if (range) {
      const parsed = parseByteRange(range, size);
      if (!parsed) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      return common(reply)
        .code(206)
        .header('Content-Range', `bytes ${parsed.start}-${parsed.end}/${size}`)
        .header('Content-Length', parsed.end - parsed.start + 1)
        .send(createReadStream(file, { start: parsed.start, end: parsed.end }));
    }
    return common(reply).code(200).header('Content-Length', size).send(createReadStream(file));
  });

  server.get<{ Params: { jobId: string } }>('/api/offline/subtitle/:jobId', async (request, reply) => {
    const job = JOB_ID_RE.test(request.params.jobId) ? getOfflineJob(currentUserId(), request.params.jobId) : null;
    const file = job ? readyVttPath(job) : null;
    if (!file) return reply.code(404).send({ error: 'not_found', message: 'No subtitles for this download.' });
    return reply
      .code(200)
      .header('Content-Type', 'text/vtt; charset=utf-8')
      .header('Cache-Control', 'private, no-store')
      .header('Access-Control-Allow-Origin', '*')
      .send(createReadStream(file));
  });
}
