import type { FastifyInstance } from 'fastify';
import { discoverDevices, knownDevice, playOnDevice, stopDevice, deviceStatus, controlDevice } from '../services/dlna.js';
import { isStreamPath, shareOrigin, signStreamPath } from '../services/stream-token.js';
import { currentActor } from '../services/user-context.js';
import { startSession, getSession, endSession, updateSessionOffset, activeSessions, setCastDeviceLookup, positionOf } from '../services/cast-session.js';

/**
 * The Cast content type when the TV's own player can play the original file (so it seeks with its remote and
 * starts at once), or null when it needs the server's conversion. Google Cast on Android TV plays these.
 */
export function tvContentType(info: { container?: string; videoCodec?: string | null; audioCodec?: string | null }): string | null {
  const container = String(info.container ?? '').toLowerCase();
  const video = String(info.videoCodec ?? '').toLowerCase();
  const audio = String(info.audioCodec ?? '').toLowerCase();
  if (!['h264', 'hevc', 'h265', 'vp9'].includes(video)) return null;
  if (audio && !['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3'].includes(audio)) return null;
  if (['mp4', 'm4v', 'mov'].includes(container)) return 'video/mp4';
  if (container === 'mkv') return 'video/x-matroska';
  if (container === 'webm') return 'video/webm';
  return null;
}

/** Cast to a TV or box on the local network (DLNA / UPnP / Chromecast). */
export default async function castRoutes(server: FastifyInstance) {
  // Wire the session service to the device cache without circular imports.
  setCastDeviceLookup(id => knownDevice(id));

  server.get<{ Querystring: { refresh?: string } }>('/api/cast/devices', async request => {
    const devices = await discoverDevices(request.query.refresh === '1');
    return { devices: devices.map(({ id, name }) => ({ id, name })) };
  });

  server.post<{ Body: {
    device?: string; path?: string; direct?: string; title?: string;
    mediaType?: string; mediaId?: string; seriesId?: string;
    start?: number; duration?: number; poster?: string;
    subtitle?: { path?: string; label?: string; lang?: string };
  } }>('/api/cast/play', async (request, reply) => {
    const device = knownDevice(String(request.body?.device ?? ''));
    if (!device) return reply.code(404).send({ message: 'That device was not found. Refresh the list and try again.' });
    const body = request.body ?? {};
    // `path` is the conversion (always playable); `direct` the original file, which the TV seeks in by itself.
    const transcodePath = String(body.path ?? '').split('?')[0] ?? '';
    const directPath = body.direct ? String(body.direct).split('?')[0] ?? '' : '';
    if (!isStreamPath(transcodePath) || (directPath && !isStreamPath(directPath))) return reply.code(400).send({ message: 'Only playback links can be cast.' });
    const actor = currentActor();
    const origin = shareOrigin(request.headers.host, request.protocol);
    const signed = (pathname: string, query = '') => `${origin}${pathname}?${query ? `${query}&` : ''}st=${signStreamPath(pathname, actor.userId)}`;
    const title = String(body.title ?? 'virtuallyView').slice(0, 120);
    const mediaType = String(body.mediaType ?? '');
    const mediaId = String(body.mediaId ?? '');
    const seriesId = body.seriesId ? String(body.seriesId) : undefined;
    const start = Math.max(0, Math.floor(Number(body.start ?? 0) || 0));
    let duration = Number(body.duration ?? 0) || 0;
    const sub = body.subtitle?.path && isStreamPath(String(body.subtitle.path).split('?')[0] ?? '') ? body.subtitle : undefined;
    const subPath = sub ? String(sub.path).split('?')[0]! : '';
    const common = {
      // The TV fetches the art itself and has no sign-in: only public (absolute) image addresses work.
      poster: body.poster && /^https?:\/\//i.test(body.poster) ? body.poster : undefined,
      metadataType: (mediaType === 'episode' ? 2 : mediaType === 'movie' ? 1 : 0) as 0 | 1 | 2,
      subtitleLabel: sub?.label ? String(sub.label).slice(0, 60) : undefined,
      subtitleLang: sub?.lang ? String(sub.lang).slice(0, 8) : undefined
    };

    let mode: 'direct' | 'transcode' | null = null;
    if (directPath) {
      // Same checks as the player's own: sign-in, age rating, which codecs the file has.
      const info = await server.inject({ method: 'GET', url: `${directPath}/info`, headers: { cookie: request.headers.cookie ?? '' } })
        .then(r => (r.statusCode === 200 ? r.json() as { container?: string; videoCodec?: string | null; audioCodec?: string | null; durationSeconds?: number | null } : null))
        .catch(() => null);
      if (info?.durationSeconds && !duration) duration = info.durationSeconds;
      const contentType = info ? tvContentType(info) : null;
      if (contentType) {
        try {
          await playOnDevice(device, signed(directPath), title, { ...common, contentType, startAt: start, subtitleUrl: sub ? signed(subPath) : undefined });
          mode = 'direct';
        } catch { /* the TV refused the original: send the conversion instead */ }
      }
    }
    try {
      if (!mode) {
        await playOnDevice(device, signed(transcodePath, `start=${start}`), title, { ...common, subtitleUrl: sub ? signed(subPath, `offset=${start}`) : undefined });
        mode = 'transcode';
      }
      // Track the session so progress is saved while the TV plays, and the remote can follow it.
      if (mediaType && mediaId) {
        startSession(device, {
          mediaType, mediaId, seriesId, offset: mode === 'direct' ? 0 : start, duration, title, actor, mode,
          resend: { transcodePath, subtitlePath: subPath || undefined, subtitleLabel: common.subtitleLabel, subtitleLang: common.subtitleLang }
        });
      }
      return { ok: true, mode, message: `Playing on ${device.name}.` };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'The device did not accept it.' });
    }
  });

  server.get<{ Querystring: { device?: string } }>('/api/cast/status', async (request, reply) => {
    const deviceId = String(request.query.device ?? '');
    const session = getSession(deviceId);
    if (!session) return reply.code(404).send({ message: 'No active session for that device.' });
    // Only the session owner may read it.
    if (session.userId !== currentActor().userId && currentActor().role !== 'admin') {
      return reply.code(403).send({ message: 'Not your session.' });
    }
    const device = knownDevice(deviceId);
    if (!device) return reply.code(404).send({ message: 'Device not found.' });
    const status = await deviceStatus(device);
    if (!status) return reply.code(502).send({ message: 'Could not reach the TV.' });
    const { position, duration } = status.state === 'IDLE' ? { position: session.lastPosition, duration: session.duration } : positionOf(session, status.currentTime, status.duration);
    return {
      state: status.state,
      position,
      duration,
      title: session.title,
      mediaType: session.mediaType,
      mediaId: session.mediaId,
    };
  });

  server.post<{ Body: { device?: string; action?: string; position?: number } }>('/api/cast/control', async (request, reply) => {
    const deviceId = String(request.body?.device ?? '');
    const session = getSession(deviceId);
    if (!session) return reply.code(404).send({ message: 'No active session for that device.' });
    if (session.userId !== currentActor().userId && currentActor().role !== 'admin') {
      return reply.code(403).send({ message: 'Not your session.' });
    }
    const device = knownDevice(deviceId);
    if (!device) return reply.code(404).send({ message: 'Device not found.' });
    const action = String(request.body?.action ?? '').toUpperCase() as 'PLAY' | 'PAUSE' | 'SEEK';
    if (!['PLAY', 'PAUSE', 'SEEK'].includes(action)) return reply.code(400).send({ message: 'action must be play, pause or seek.' });

    try {
      if (action === 'SEEK') {
        const seekTo = Math.max(0, Math.floor(Number(request.body?.position) || 0));
        if (session.mode === 'direct' || !session.resend) await controlDevice(device, 'SEEK', seekTo);
        else {
          // A conversion cannot seek in place: send it again, converted from the new position.
          const { transcodePath, subtitlePath, subtitleLabel, subtitleLang } = session.resend;
          const origin = shareOrigin(request.headers.host, request.protocol);
          const signed = (pathname: string, query: string) => `${origin}${pathname}?${query}&st=${signStreamPath(pathname, session.userId)}`;
          await playOnDevice(device, signed(transcodePath, `start=${seekTo}`), session.title, {
            subtitleUrl: subtitlePath ? signed(subtitlePath, `offset=${seekTo}`) : undefined, subtitleLabel, subtitleLang
          });
          updateSessionOffset(deviceId, seekTo);
        }
      } else {
        await controlDevice(device, action);
      }
      return { ok: true };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'The device did not respond.' });
    }
  });

  server.post<{ Body: { device?: string } }>('/api/cast/stop', async (request, reply) => {
    const deviceId = String(request.body?.device ?? '');
    const device = knownDevice(deviceId);
    if (!device) return reply.code(404).send({ message: 'That device was not found.' });
    const owner = getSession(deviceId)?.userId;
    if (owner && owner !== currentActor().userId && currentActor().role !== 'admin') return reply.code(403).send({ message: 'Not your session.' });
    try {
      // endSession reads the TV's position and saves progress, then stopDevice sends the stop command.
      const position = await endSession(device, true);
      await stopDevice(device).catch(() => undefined); // best effort; device may already be stopped
      return { ok: true, position };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'The device did not respond.' });
    }
  });

  server.get('/api/cast/active', async () => {
    const actor = currentActor();
    return { sessions: activeSessions(actor.userId) };
  });
}
