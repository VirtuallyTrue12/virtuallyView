import type { FastifyInstance } from 'fastify';
import type { BazarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from '../services/registry.js';

const LANGUAGE = /^[a-z]{2,3}$/;
const ALLOWED = /\.(srt|ass|ssa|vtt|sub)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

interface UploadBody { language?: string; filename?: string; content?: string }

/**
 * Subtitle search and manual upload. Bazarr does the work (sources, matching,
 * saving next to the video); these routes just point it at one movie or episode.
 */
export default async function subtitleRoutes(server: FastifyInstance) {
  const bazarr = () => getAdapter<BazarrAdapter>('bazarr');
  const numeric = (value: string, prefix: string): number | null => {
    const n = Number(value.replace(new RegExp(`^${prefix}-`), ''));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const wrap = async (reply: { code: (n: number) => unknown }, run: () => Promise<{ success: boolean; message: string }>) => {
    try {
      const result = await run();
      if (!result.success) reply.code(422);
      return result;
    } catch (error) {
      reply.code(503);
      const text = error instanceof Error ? error.message : '';
      return { success: false, message: /not connected|not configured|setup/i.test(text) || !text ? 'Subtitles are handled by Bazarr and it is not connected. An administrator can connect it under Settings > Integrations.' : text };
    }
  };
  const decode = (body: UploadBody | undefined): { language: string; filename: string; data: Buffer } | string => {
    const language = (body?.language ?? 'en').toLowerCase();
    if (!LANGUAGE.test(language)) return 'Choose a language.';
    const filename = (body?.filename ?? '').replace(/[^\w.\- ()]/g, '_').slice(0, 120);
    if (!ALLOWED.test(filename)) return 'Upload a .srt, .ass, .ssa, .vtt or .sub file.';
    const data = Buffer.from(body?.content ?? '', 'base64');
    if (data.length === 0) return 'The file is empty.';
    if (data.length > MAX_BYTES) return 'That file is too large for a subtitle.';
    return { language, filename, data };
  };

  server.get('/api/subtitles/languages', async () => {
    try {
      return { connected: true, languages: await bazarr().enabledLanguages() };
    } catch {
      return { connected: false, languages: [] };
    }
  });

  server.post<{ Params: { id: string }; Body: { language?: string } }>('/api/movies/:id/subtitles/search', (request, reply) =>
    wrap(reply, async () => {
      const id = numeric(request.params.id, 'radarr');
      const language = (request.body?.language ?? 'en').toLowerCase();
      if (!id || !LANGUAGE.test(language)) return { success: false, message: 'Unknown movie or language.' };
      return bazarr().searchMovieSubtitles(id, language);
    }));

  server.post<{ Params: { id: string; episodeId: string }; Body: { language?: string } }>('/api/series/:id/episodes/:episodeId/subtitles/search', (request, reply) =>
    wrap(reply, async () => {
      const series = numeric(request.params.id, 'sonarr');
      const episode = numeric(request.params.episodeId, 'episode');
      const language = (request.body?.language ?? 'en').toLowerCase();
      if (!series || !episode || !LANGUAGE.test(language)) return { success: false, message: 'Unknown episode or language.' };
      return bazarr().searchEpisodeSubtitles(series, episode, language);
    }));

  server.post<{ Params: { id: string }; Body: UploadBody }>('/api/movies/:id/subtitles/upload', { bodyLimit: 4 * 1024 * 1024 }, (request, reply) =>
    wrap(reply, async () => {
      const id = numeric(request.params.id, 'radarr');
      const file = decode(request.body);
      if (!id) return { success: false, message: 'Unknown movie.' };
      if (typeof file === 'string') return { success: false, message: file };
      return bazarr().uploadMovieSubtitle(id, file.language, file.filename, file.data);
    }));

  server.post<{ Params: { id: string; episodeId: string }; Body: UploadBody }>('/api/series/:id/episodes/:episodeId/subtitles/upload', { bodyLimit: 4 * 1024 * 1024 }, (request, reply) =>
    wrap(reply, async () => {
      const series = numeric(request.params.id, 'sonarr');
      const episode = numeric(request.params.episodeId, 'episode');
      const file = decode(request.body);
      if (!series || !episode) return { success: false, message: 'Unknown episode.' };
      if (typeof file === 'string') return { success: false, message: file };
      return bazarr().uploadEpisodeSubtitle(series, episode, file.language, file.filename, file.data);
    }));
}
