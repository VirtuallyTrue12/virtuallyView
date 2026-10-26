import type { FastifyInstance } from 'fastify';
import { discoverDevices, knownDevice, playOnDevice, stopDevice, deviceStatus, controlDevice } from '../services/dlna.js';
import { isStreamPath, shareOrigin, signStreamPath } from '../services/stream-token.js';
import { currentActor } from '../services/user-context.js';
import { startSession, getSession, endSession, updateSessionOffset, activeSessions, setCastDeviceLookup } from '../services/cast-session.js';

/** Cast to a TV or box on the local network (DLNA / UPnP / Chromecast). */
export default async function castRoutes(server: FastifyInstance) {
  // Wire the session service to the device cache without circular imports.
  setCastDeviceLookup(id => knownDevice(id));

  server.get<{ Querystring: { refresh?: string } }>('/api/cast/devices', async request => {
    const devices = await discoverDevices(request.query.refresh === '1');
    return { devices: devices.map(({ id, name }) => ({ id, name })) };
  });

  server.post<{ Body: {
    device?: string; path?: string; title?: string;
    mediaType?: string; mediaId?: string; seriesId?: string;
    start?: number; duration?: number; poster?: string;
    subtitleUrl?: string; subtitleLabel?: string; subtitleLang?: string;
  } }>('/api/cast/play', async (request, reply) => {
    const device = knownDevice(String(request.body?.device ?? ''));
    if (!device) return reply.code(404).send({ message: 'That device was not found. Refresh the list and try again.' });
    const full = String(request.body?.path ?? '');
    const pathname = full.split('?')[0] ?? '';
    if (!isStreamPath(pathname)) return reply.code(400).send({ message: 'Only playback links can be cast.' });
    const separator = full.includes('?') ? '&' : '?';
    const actor = currentActor();
    const url = `${shareOrigin(request.headers.host, request.protocol)}${full}${separator}st=${signStreamPath(pathname, actor.userId)}`;
    const title = String(request.body?.title ?? 'virtuallyView').slice(0, 120);
    const mediaType = String(request.body?.mediaType ?? '');
    const mediaId = String(request.body?.mediaId ?? '');
    const seriesId = request.body?.seriesId ? String(request.body.seriesId) : undefined;
    const start = Number(request.body?.start ?? 0) || 0;
    const duration = Number(request.body?.duration ?? 0) || 0;
    const poster = request.body?.poster ? String(request.body.poster) : undefined;

    // Determine metadata type: 2 = tv episode, 1 = movie, 0 = generic.
    let metadataType: 0 | 1 | 2 = 0;
    if (mediaType === 'episode') metadataType = 2;
    else if (mediaType === 'movie') metadataType = 1;

    try {
      await playOnDevice(device, url, title, {
        poster: poster ? `${shareOrigin(request.headers.host, request.protocol)}${poster}` : undefined,
        metadataType,
        subtitleUrl: request.body?.subtitleUrl,
        subtitleLabel: request.body?.subtitleLabel,
        subtitleLang: request.body?.subtitleLang,
      });
      // Start tracking this session so progress is saved while the TV plays.
      if (mediaType && mediaId) {
        startSession(device, { mediaType, mediaId, seriesId, offset: start, duration, title, actor });
      }
      return { ok: true, message: `Playing on ${device.name}.` };
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
    return {
      state: status.state,
      position: session.offset + status.currentTime,
      duration: status.duration ?? session.duration,
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
      if (action === 'SEEK' && request.body?.position !== undefined) {
        const seekTo = Number(request.body.position);
        // Transcode streams are not seekable in place: re-LOAD from the new position.
        const session2 = getSession(deviceId)!;
        const newPath = `/api/stream${session2.mediaType === 'episode' ? `/episode/${encodeURIComponent(session2.mediaId)}` : `/${encodeURIComponent(session2.mediaId)}`}/transcode?start=${Math.floor(seekTo)}`;
        const pathname = newPath.split('?')[0]!;
        const actor = currentActor();
        const url = `${shareOrigin(request.headers.host, request.protocol)}${newPath}&st=${signStreamPath(pathname, actor.userId)}`;
        await playOnDevice(device, url, session2.title);
        updateSessionOffset(deviceId, seekTo);
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
