import { createReadStream, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Media } from '@virtuallyview/types';
import type { SonarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from '../services/registry.js';
import { getMediaRoots, isAllowedMediaFile } from '../services/media-roots.js';
import { resolveMusicVideoPath } from '../services/music-video-library.js';
import { extractSubtitleVtt, ffmpegAvailable, probeMedia, startTranscode, type TranscodeOptions } from '../services/transcode.js';
import { ensureHlsSession, HLS_SEGMENT_RE, playlistPath, segmentPath, touchHlsSession } from '../services/hls-sessions.js';
import { ratingAllowed } from '../services/parental.js';
import { parseByteRange } from '../lib/byte-range.js';
import { currentActor } from '../services/user-context.js';
import { trickplayFor } from '../services/trickplay.js';
import { acquireConversion, CONVERSION_MAX_MS } from '../lib/limits.js';

type Streamable = Media & { streamUrl?: string; fileInfo?: { path?: string; size?: number } };

// Safari (and several TV and embedded browsers) refuse to play a <video> whose Content-Type is missing or wrong,
// even when the bytes themselves are fine and a less strict browser (most Chromium builds) plays them anyway.
// Every extension the library scanner accepts (music-videos.ts VIDEO_EXT) needs an entry here for that reason.
const CID_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.vob': 'video/mpeg'
};

export { getMediaRoots, isAllowedMediaFile };

/** The Content-Type a direct (non-transcoded) file is served with, by extension. */
export const contentTypeFor = (filePath: string): string => CID_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';

/** True when a real, allowed file exists at this path. */
function isServable(filePath: string | null | undefined): filePath is string {
  return (
    typeof filePath === 'string' &&
    filePath.length > 0 &&
    existsSync(filePath) &&
    isAllowedMediaFile(filePath)
  );
}

/** Serve one media file with HTTP range support so seeking stays instant. */
function serveMediaFile(
  request: FastifyRequest,
  reply: FastifyReply,
  filePath: string
): FastifyReply {
  const safePath = realpathSync(filePath);
  const stat = statSync(safePath);
  const mime = contentTypeFor(filePath);
  const range = request.headers.range;

  if (range) {
    const parsed = parseByteRange(range, stat.size, 1024 * 1024);
    if (!parsed) {
      return reply
        .code(416)
        .header('Content-Range', `bytes */${stat.size}`)
        .header('Access-Control-Allow-Origin', '*')
        .send();
    }
    const { start, end } = parsed;

    return reply
      .code(206)
      .header('Content-Type', mime)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      .header('Content-Length', end - start + 1)
      .header('Cache-Control', 'no-store')
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Range, Content-Type')
      .send(createReadStream(safePath, { start, end }));
  }

  return reply
    .code(200)
    .header('Content-Type', mime)
    .header('Accept-Ranges', 'bytes')
    .header('Content-Length', stat.size)
    .header('Cache-Control', 'no-store')
    .header('Access-Control-Allow-Origin', '*')
    .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    .header('Access-Control-Allow-Headers', 'Range, Content-Type')
    .send(createReadStream(safePath));
}

/** Browser-capability summary for a media file, used to decide direct vs. transcode. */
async function mediaInfoFor(filePath: string) {
  const probe = await probeMedia(filePath);
  return {
    playable: probe.playable,
    container: probe.container,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    durationSeconds: probe.durationSeconds,
    reason: probe.reason ?? null,
    transcodingAvailable: ffmpegAvailable(),
    width: probe.width ?? null,
    height: probe.height ?? null,
    bitrate: probe.bitrate ?? null,
    sizeBytes: probe.sizeBytes ?? null,
    audioTracks: probe.audioTracks ?? [],
    subtitleStreams: probe.subtitleStreams ?? [],
    chapters: probe.chapters ?? []
  };
}

const LANG_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
function languageName(code: string): string {
  if (!code || code === 'und') return 'Unknown';
  try { return LANG_NAMES.of(code) ?? code; } catch { return code; }
}

/** Sidecar subtitle files plus text subtitle streams embedded in the media file. */
async function allSubtitleTracks(filePath: string, baseUrl: string) {
  const sidecar = listSubtitleTracks(filePath, baseUrl);
  const probe = await probeMedia(filePath);
  const embedded = (probe.subtitleStreams ?? []).filter(sub => sub.text).map(sub => ({
    src: `${baseUrl}/embedded/${sub.index}`,
    label: `${sub.title || languageName(sub.language)} (embedded)`,
    srclang: sub.language.length === 2 || sub.language.length === 3 ? sub.language : 'und'
  }));
  return [...sidecar, ...embedded];
}

const embeddedCache = new Map<string, string>();
async function sendEmbeddedSubtitle(reply: FastifyReply, filePath: string, index: number, offset: number) {
  const key = `${filePath}#${index}`;
  let vtt = embeddedCache.get(key);
  if (vtt === undefined) {
    const extracted = await extractSubtitleVtt(filePath, index);
    if (extracted === null) return reply.code(422).send({ error: 'subtitle_unavailable', message: 'That subtitle track could not be extracted.' });
    vtt = extracted;
    if (embeddedCache.size > 40) embeddedCache.clear();
    embeddedCache.set(key, vtt);
  }
  return reply
    .code(200)
    .header('Content-Type', 'text/vtt; charset=utf-8')
    .header('Cache-Control', 'private, max-age=3600')
    .send(shiftVtt(vtt, offset));
}

/** Stream an on-the-fly H.264/AAC MP4 conversion of a file that browsers cannot play. */
type TranscodeQuery = { start?: string; audio?: string; height?: string; burn?: string };

/** The same options a browser's query string asks for (audio track, quality cap, burned-in subtitle),
 * shared by the progressive and HLS conversion routes so the two never disagree. */
async function transcodeOptionsFor(filePath: string, query: TranscodeQuery): Promise<{ start: number; options: TranscodeOptions }> {
  const start = Math.max(0, Number(query.start) || 0);
  const probe = await probeMedia(filePath);
  const height = Math.round(Number(query.height) || 0);
  const options: TranscodeOptions = {
    audio: Math.max(0, Math.round(Number(query.audio) || 0)),
    ...(height >= 144 && height <= 4320 && (!probe.height || height < probe.height) ? { height } : {}),
    copyVideo: probe.videoCopyOk === true
  };
  const burn = Number(query.burn);
  if (query.burn !== undefined && Number.isInteger(burn) && probe.subtitleStreams?.[burn] && !probe.subtitleStreams[burn]?.text) {
    options.burn = burn;
  }
  return { start, options };
}

async function streamTranscode(
  request: FastifyRequest<{ Querystring: TranscodeQuery }>,
  reply: FastifyReply,
  filePath: string
) {
  const { start, options } = await transcodeOptionsFor(filePath, request.query);
  const release = acquireConversion(currentActor().userId);
  if (!release) {
    return reply.code(429).header('Retry-After', '30').send({ error: 'too_many_conversions', message: 'Too many videos are being converted right now. Close another player or try again in a moment.' });
  }
  const handle = startTranscode(filePath, start, options);
  if (!handle) {
    release();
    return reply.code(503).header('Access-Control-Allow-Origin', '*').send({
      error: 'transcode_unavailable',
      message: 'This file needs conversion, but ffmpeg is not installed on the server.'
    });
  }
  const child = handle.process;
  if (!child.stdout) {
    release();
    return reply.code(503).header('Access-Control-Allow-Origin', '*').send({ error: 'transcode_unavailable', message: 'The converter could not start.' });
  }
  const limit = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } }, CONVERSION_MAX_MS);
  child.on('close', () => { clearTimeout(limit); release(); });
  request.raw.on('close', () => {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  });
  child.on('error', () => {
    try { reply.raw.destroy(); } catch { /* connection already gone */ }
  });
  // Drain stderr so the pipe never blocks the encoder.
  child.stderr?.on('data', () => { /* ffmpeg diagnostics are intentionally discarded */ });
  return reply
    .code(200)
    .header('Content-Type', 'video/mp4')
    .header('Cache-Control', 'no-store')
    .header('Accept-Ranges', 'none')
    .header('Access-Control-Allow-Origin', '*')
    .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    .header('Access-Control-Allow-Headers', 'Range, Content-Type')
    .send(child.stdout);
}

const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The playlist for one HLS session, starting its ffmpeg conversion if this is the first request for it. */
async function hlsPlaylist(request: FastifyRequest<{ Querystring: TranscodeQuery }>, reply: FastifyReply, filePath: string, sessionKey: string) {
  const { start, options } = await transcodeOptionsFor(filePath, request.query);
  const opened = ensureHlsSession(sessionKey, currentActor().userId, filePath, start, options);
  if (!opened.ok) return reply.code(opened.status).header('Access-Control-Allow-Origin', '*').send({ error: 'transcode_unavailable', message: opened.message });
  const file = playlistPath(opened.dir);
  // The first segment or two take a moment to encode; the playlist does not exist until ffmpeg writes it.
  for (let tries = 0; tries < 40 && !existsSync(file); tries++) await wait(250);
  if (!existsSync(file)) return reply.code(503).header('Access-Control-Allow-Origin', '*').send({ error: 'transcode_unavailable', message: 'The converter has not produced anything yet. Reload to try again.' });
  return reply.header('Content-Type', 'application/vnd.apple.mpegurl').header('Cache-Control', 'no-store').header('Access-Control-Allow-Origin', '*').send(readFileSync(file, 'utf8'));
}

/** One segment of an HLS session already in progress. */
function hlsSegment(reply: FastifyReply, sessionKey: string, segment: string) {
  if (!HLS_SEGMENT_RE.test(segment)) return reply.code(400).send({ error: 'bad_request', message: 'Invalid segment name.' });
  const dir = touchHlsSession(sessionKey);
  if (!dir) return reply.code(404).send({ error: 'not_found', message: 'That session has ended. Reload the page to start a new one.' });
  const file = segmentPath(dir, segment);
  if (!existsSync(file)) return reply.code(404).send();
  return reply.header('Content-Type', 'video/mp2t').header('Cache-Control', 'no-store').header('Access-Control-Allow-Origin', '*').send(createReadStream(file));
}

/** Browsers only load WebVTT in <track>; convert SRT/ASS sidecars on the fly. */
function subtitleToVtt(text: string, ext: string): string {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (ext === '.vtt') return clean;
  if (ext === '.srt') {
    return 'WEBVTT\n\n' + clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }
  // .ass / .ssa: keep Dialogue lines only, strip override tags.
  const toTime = (t: string) => {
    const m = /^(\d+):(\d{2}):(\d{2})[.](\d{2})$/.exec(t.trim());
    return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${m[4]}0` : '00:00:00.000';
  };
  const cues: string[] = [];
  for (const line of clean.split('\n')) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.slice(9).split(',');
    if (parts.length < 10) continue;
    const body = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim();
    if (body) cues.push(`${toTime(parts[1])} --> ${toTime(parts[2])}\n${body}`);
  }
  return 'WEBVTT\n\n' + cues.join('\n\n');
}

/** Shift every cue back by `offset` seconds (transcoded streams restart at 0). */
function shiftVtt(vtt: string, offset: number): string {
  if (!(offset > 0)) return vtt;
  const parse = (t: string) => {
    const parts = t.split(':').map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  };
  const format = (sec: number) => {
    const ms = Math.round(sec * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const rest = ms % 60000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(rest / 1000)).padStart(2, '0')}.${String(rest % 1000).padStart(3, '0')}`;
  };
  const blocks = vtt.split(/\n{2,}/);
  const kept = [blocks[0]];
  for (const block of blocks.slice(1)) {
    const lines = block.split('\n');
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->').map(x => x.trim().split(/\s+/)[0]);
    const start = parse(a) - offset;
    const end = parse(b) - offset;
    if (end <= 0) continue;
    lines[at] = `${format(Math.max(0, start))} --> ${format(end)}`;
    kept.push(lines.join('\n'));
  }
  return kept.join('\n\n');
}

function sendSubtitle(reply: FastifyReply, candidate: string, offset = 0) {
  const ext = path.extname(candidate).toLowerCase();
  const vtt = shiftVtt(subtitleToVtt(readFileSync(candidate, 'utf8'), ext), offset);
  return reply
    .code(200)
    .header('Content-Type', 'text/vtt; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('Access-Control-Allow-Origin', '*')
    .send(vtt);
}

/**
 * Subtitle tracks that sit next to a media file. Files must live inside a media
 * root (same rule as the video), so no arbitrary path is ever served.
 * `baseStreamUrl` is the route the browser should fetch each track from.
 */
function listSubtitleTracks(mediaFilePath: string, baseStreamUrl: string) {
  const basePath = path.dirname(mediaFilePath);
  const baseName = path.basename(mediaFilePath, path.extname(mediaFilePath)).toLowerCase();
  // Season folders hold many episodes: only subtitles named after THIS file.
  const dirEntries = readdirSync(basePath).filter(entry => {
    const ext = path.extname(entry).toLowerCase();
    return ['.srt', '.vtt', '.ass', '.ssa'].includes(ext) && entry.toLowerCase().startsWith(baseName);
  });

  const tracks: Array<{ src: string; label: string; srclang: string; default?: boolean }> = [];
  for (const entry of dirEntries) {
    const candidate = path.join(basePath, entry);
    if (!isAllowedMediaFile(candidate)) continue;
    const lower = entry.toLowerCase();
    // Match well-known language/language-code patterns: "en", "english",
    // "moviename.en.srt", "moviename.english.srt".
    const m = /\.([a-z]{2,3})(?:\.|$)/i.exec(lower.replace(baseName, ''));
    const srclang = m?.[1]?.toLowerCase() ?? undefined;
    let label = srclang ?? path.basename(entry);
    if (srclang) {
      try { label = new Intl.DisplayNames(['en'], { type: 'language' }).of(srclang) ?? srclang; } catch { label = srclang; }
    }
    const src = `${baseStreamUrl}/subtitle/${encodeURIComponent(path.basename(entry))}`;
    // English subtitles are the most common; prefer them as the default track.
    tracks.push({ src, label, srclang: srclang ?? 'en', default: srclang === 'en' });
  }
  return tracks;
}

async function resolveStreamable(id: string): Promise<Streamable | null> {
  if (id.startsWith('musicvideo-')) {
    const file = await resolveMusicVideoPath(id);
    return file ? { fileInfo: { path: file } } as unknown as Streamable : null;
  }
  const radarr = getAdapter('radarr');
  const sonarr = getAdapter('sonarr');
  try {
    const movie = await radarr.getItem(id);
    if (movie) return ratingAllowed((movie as { certification?: string }).certification) ? movie as Streamable : null;
  } catch {
    // Radarr offline or unconfigured
  }
  try {
    const series = await sonarr.getItem(id);
    if (series) return ratingAllowed((series as { certification?: string }).certification) ? series as Streamable : null;
  } catch {
    // Sonarr offline or unconfigured
  }
  return null;
}

/** Resolve the on-disk file for a Sonarr episode id (`episode-123`). */
async function resolveEpisodeFile(id: string): Promise<string | null> {
  try {
    const sonarr = getAdapter<SonarrAdapter>('sonarr');
    const file = await sonarr.getEpisodeFile(id);
    return file?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Every playback route for an episode is judged by the parent series' age
 * rating, the same rule the series page uses. Knowing an episode id is not
 * enough. A restricted viewer with a rating that cannot be confirmed is
 * refused (unknown is not safe).
 */
async function episodeAllowed(id: string): Promise<boolean> {
  const actor = currentActor();
  if (actor.role !== 'user' || !actor.maxRating) return true;
  try {
    return ratingAllowed(await getAdapter<SonarrAdapter>('sonarr').getEpisodeCertification(id));
  } catch {
    return false;
  }
}

export default async function streamRoutes(server: FastifyInstance) {
  server.addHook('preHandler', async (request, reply) => {
    const match = /^\/api\/stream\/episode\/([^/?]+)/.exec(request.url);
    if (match && !(await episodeAllowed(decodeURIComponent(match[1]!)))) {
      return reply.code(403).send({ error: 'age_restricted', message: 'This is above the age limit set for your account.' });
    }
  });

  server.get<{ Params: { id: string } }>('/api/stream/episode/:id', async (request, reply) => {
    const filePath = await resolveEpisodeFile(request.params.id);
    if (!isServable(filePath)) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'This episode has no playable file on the server yet.'
      });
    }
    return serveMediaFile(request, reply, filePath);
  });

  server.get<{ Params: { id: string } }>('/api/stream/episode/:id/subtitles', async (request) => {
    const filePath = await resolveEpisodeFile(request.params.id);
    if (!isServable(filePath)) return { subtitles: [] };
    return {
      subtitles: await allSubtitleTracks(filePath, `/api/stream/episode/${encodeURIComponent(request.params.id)}`)
    };
  });

  server.get<{ Params: { id: string; index: string }; Querystring: { offset?: string } }>(
    '/api/stream/episode/:id/embedded/:index',
    async (request, reply) => {
      const filePath = await resolveEpisodeFile(request.params.id);
      if (!isServable(filePath)) return reply.code(404).send({ error: 'not_found', message: 'No media file for this episode.' });
      return sendEmbeddedSubtitle(reply, filePath, Number(request.params.index), Number(request.query.offset) || 0);
    }
  );

  server.get<{ Params: { id: string; index: string }; Querystring: { offset?: string } }>(
    '/api/stream/:id/embedded/:index',
    async (request, reply) => {
      const item = await resolveStreamable(request.params.id);
      const filePath = item?.fileInfo?.path;
      if (!isServable(filePath)) return reply.code(404).send({ error: 'not_found', message: 'No media file for this item.' });
      return sendEmbeddedSubtitle(reply, filePath, Number(request.params.index), Number(request.query.offset) || 0);
    }
  );

  server.get<{ Params: { id: string; file: string } }>(
    '/api/stream/episode/:id/subtitle/:file',
    async (request, reply) => {
      const { id, file } = request.params;
      if (!/^[^/\\]+$/.test(file)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Invalid subtitle file name.' });
      }
      const filePath = await resolveEpisodeFile(id);
      if (!isServable(filePath)) {
        return reply.code(404).send({ error: 'not_found', message: 'No media file for this episode.' });
      }
      const candidate = path.join(path.dirname(filePath), file);
      if (!existsSync(candidate) || !isAllowedMediaFile(candidate)) {
        return reply.code(404).send({ error: 'not_found', message: 'Subtitle file not found.' });
      }
      return sendSubtitle(reply, candidate, Number((request.query as { offset?: string }).offset) || 0);
    }
  );

  server.get<{ Params: { id: string } }>('/api/stream/:id', async (request, reply) => {
    const { id } = request.params;
    const item = await resolveStreamable(id);
    const filePath = item?.fileInfo?.path;

    // Local file available - serve with range support
    if (isServable(filePath)) {
      return serveMediaFile(request, reply, filePath);
    }

    // Curated catalog item - redirect to the public preview URL
    if (item?.streamUrl) {
      return reply.redirect(item.streamUrl, 302);
    }

    return reply.code(404).send({
      error: 'not_found',
      message: 'No local file or stream URL available for this item yet.'
    });
  });

  // Subtitle tracks for a movie or series file. No external or arbitrary paths
  // are ever served.
  server.get<{ Params: { id: string } }>('/api/stream/:id/subtitles', async (request) => {
    const { id } = request.params;
    const item = await resolveStreamable(id);
    const filePath = item?.fileInfo?.path;
    if (!isServable(filePath)) {
      return { subtitles: [] };
    }
    return { subtitles: await allSubtitleTracks(filePath, `/api/stream/${encodeURIComponent(id)}`) };
  });

  server.get<{ Params: { id: string; file: string } }>('/api/stream/:id/subtitle/:file', async (request, reply) => {
    const { id, file } = request.params;
    if (!/^[^/\\]+$/.test(file)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid subtitle file name.' });
    }
    const item = await resolveStreamable(id);
    const filePath = item?.fileInfo?.path;
    if (!isServable(filePath)) {
      return reply.code(404).send({ error: 'not_found', message: 'No media file for this item.' });
    }
    const candidate = path.join(path.dirname(filePath), file);
    if (!existsSync(candidate) || !isAllowedMediaFile(candidate)) {
      return reply.code(404).send({ error: 'not_found', message: 'Subtitle file not found.' });
    }
    return sendSubtitle(reply, candidate, Number((request.query as { offset?: string }).offset) || 0);
  });

  // -- Playback capability and on-the-fly conversion ------------------------
  // The player asks "can this browser play it?" before starting; when the
  // answer is no and ffmpeg is installed, it falls back to these transcode
  // routes instead of showing a decode error.
  server.get<{ Params: { id: string } }>('/api/stream/episode/:id/info', async (request, reply) => {
    const filePath = await resolveEpisodeFile(request.params.id);
    if (!isServable(filePath)) {
      return reply.code(404).send({ error: 'not_found', message: 'This episode has no playable file on the server yet.' });
    }
    return mediaInfoFor(filePath);
  });

  server.get<{ Params: { id: string }; Querystring: TranscodeQuery }>(
    '/api/stream/episode/:id/transcode',
    async (request, reply) => {
      const filePath = await resolveEpisodeFile(request.params.id);
      if (!isServable(filePath)) {
        return reply.code(404).send({ error: 'not_found', message: 'This episode has no playable file on the server yet.' });
      }
      return streamTranscode(request, reply, filePath);
    }
  );

  server.get<{ Params: { id: string; session: string }; Querystring: TranscodeQuery }>(
    '/api/stream/episode/:id/transcode/hls/:session/index.m3u8',
    async (request, reply) => {
      if (!SESSION_RE.test(request.params.session)) return reply.code(400).send({ error: 'bad_request', message: 'Invalid session.' });
      const filePath = await resolveEpisodeFile(request.params.id);
      if (!isServable(filePath)) return reply.code(404).send({ error: 'not_found', message: 'This episode has no playable file on the server yet.' });
      return hlsPlaylist(request, reply, filePath, `ep:${request.params.id}:${request.params.session}`);
    }
  );
  server.get<{ Params: { id: string; session: string; segment: string } }>(
    '/api/stream/episode/:id/transcode/hls/:session/:segment',
    async (request, reply) => hlsSegment(reply, `ep:${request.params.id}:${request.params.session}`, request.params.segment)
  );

  server.get<{ Params: { id: string } }>('/api/stream/:id/info', async (request, reply) => {
    const item = await resolveStreamable(request.params.id);
    const filePath = item?.fileInfo?.path;
    if (!isServable(filePath)) {
      return reply.code(404).send({ error: 'not_found', message: 'No local file is available for this item yet.' });
    }
    return mediaInfoFor(filePath);
  });

  server.get<{ Params: { id: string }; Querystring: TranscodeQuery }>(
    '/api/stream/:id/transcode',
    async (request, reply) => {
      const item = await resolveStreamable(request.params.id);
      const filePath = item?.fileInfo?.path;
      if (!isServable(filePath)) {
        return reply.code(404).send({ error: 'not_found', message: 'No local file is available for this item yet.' });
      }
      return streamTranscode(request, reply, filePath);
    }
  );

  server.get<{ Params: { id: string; session: string }; Querystring: TranscodeQuery }>(
    '/api/stream/:id/transcode/hls/:session/index.m3u8',
    async (request, reply) => {
      if (!SESSION_RE.test(request.params.session)) return reply.code(400).send({ error: 'bad_request', message: 'Invalid session.' });
      const item = await resolveStreamable(request.params.id);
      const filePath = item?.fileInfo?.path;
      if (!isServable(filePath)) return reply.code(404).send({ error: 'not_found', message: 'No local file is available for this item yet.' });
      return hlsPlaylist(request, reply, filePath, `mv:${request.params.id}:${request.params.session}`);
    }
  );
  server.get<{ Params: { id: string; session: string; segment: string } }>(
    '/api/stream/:id/transcode/hls/:session/:segment',
    async (request, reply) => hlsSegment(reply, `mv:${request.params.id}:${request.params.session}`, request.params.segment)
  );

  // Seek-bar preview thumbnails: JSON while they are being made, then a sprite image.
  const trickplay = async (filePath: string | null | undefined, reply: FastifyReply, wantImage: boolean) => {
    if (!isServable(filePath)) return reply.code(404).send({ state: 'unavailable' });
    const t = trickplayFor(filePath);
    if (!wantImage) return t.state === 'ready' ? { state: 'ready', ...t.meta } : { state: t.state };
    if (t.state !== 'ready') return reply.code(404).send({ state: t.state });
    return reply.header('Cache-Control', 'public, max-age=31536000, immutable').type('image/jpeg').send(createReadStream(t.image));
  };
  server.get<{ Params: { id: string } }>('/api/stream/:id/trickplay', async (request, reply) => trickplay((await resolveStreamable(request.params.id))?.fileInfo?.path, reply, false));
  server.get<{ Params: { id: string } }>('/api/stream/:id/trickplay.jpg', async (request, reply) => trickplay((await resolveStreamable(request.params.id))?.fileInfo?.path, reply, true));
  server.get<{ Params: { id: string } }>('/api/stream/episode/:id/trickplay', async (request, reply) => trickplay(await resolveEpisodeFile(request.params.id), reply, false));
  server.get<{ Params: { id: string } }>('/api/stream/episode/:id/trickplay.jpg', async (request, reply) => trickplay(await resolveEpisodeFile(request.params.id), reply, true));
}
