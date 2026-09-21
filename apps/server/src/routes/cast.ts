import type { FastifyInstance } from 'fastify';
import { discoverDevices, knownDevice, playOnDevice, stopDevice } from '../services/dlna.js';
import { isStreamPath, shareOrigin, signStreamPath } from '../services/stream-token.js';
import { currentActor } from '../services/user-context.js';

/** Cast to a TV or box on the local network (DLNA / UPnP). */
export default async function castRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { refresh?: string } }>('/api/cast/devices', async request => {
    const devices = await discoverDevices(request.query.refresh === '1');
    return { devices: devices.map(({ id, name }) => ({ id, name })) };
  });

  server.post<{ Body: { device?: string; path?: string; title?: string } }>('/api/cast/play', async (request, reply) => {
    const device = knownDevice(String(request.body?.device ?? ''));
    if (!device) return reply.code(404).send({ message: 'That device was not found. Refresh the list and try again.' });
    const full = String(request.body?.path ?? '');
    const pathname = full.split('?')[0] ?? '';
    if (!isStreamPath(pathname)) return reply.code(400).send({ message: 'Only playback links can be cast.' });
    const separator = full.includes('?') ? '&' : '?';
    const url = `${shareOrigin(request.headers.host, request.protocol)}${full}${separator}st=${signStreamPath(pathname, currentActor().userId)}`;
    try {
      await playOnDevice(device, url, String(request.body?.title ?? 'virtuallyView').slice(0, 120));
      return { ok: true, message: `Playing on ${device.name}.` };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'The device did not accept it.' });
    }
  });

  server.post<{ Body: { device?: string } }>('/api/cast/stop', async (request, reply) => {
    const device = knownDevice(String(request.body?.device ?? ''));
    if (!device) return reply.code(404).send({ message: 'That device was not found.' });
    try {
      await stopDevice(device);
      return { ok: true };
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : 'The device did not respond.' });
    }
  });
}
