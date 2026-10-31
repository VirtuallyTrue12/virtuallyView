import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { currentActor } from '../services/user-context.js';
import * as listen from '../services/listen-session.js';
import * as devices from '../services/music-devices.js';

/**
 * Listen together and play on another device, both over server-sent events
 * (the same transport as watch-party). Commands come in as plain POSTs; the
 * server checks who may do what, then pushes the new state to everyone in the session.
 */

const MAX_LISTENERS = 25 * 4;
/** A member whose stream drops is only removed after this, so a page reload does not cost them the host. */
const RECONNECT_GRACE_MS = 20_000;

type Conn = { userId: string; res: ServerResponse };
const listenConns = new Map<string, Map<string, Conn>>();
const pendingLeave = new Map<string, ReturnType<typeof setTimeout>>();

type DeviceConn = { deviceId: string; res: ServerResponse };
const deviceConns = new Map<string, Map<string, DeviceConn>>();

function send(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** What one listener sees: the whole session, plus who they are and whether they can act. */
function viewFor(s: listen.ListenSession, you: string, now = Date.now()) {
  return {
    code: s.code,
    host: s.host,
    everyoneControl: s.everyoneControl,
    members: s.members.map(m => ({ userId: m.userId, name: m.name, host: m.userId === s.host })),
    queue: s.queue,
    index: s.index,
    playing: s.playing,
    position: listen.positionAt(s, now),
    updatedAt: s.updatedAt,
    seq: s.seq,
    serverNow: now,
    you,
    youAreHost: listen.isHost(s, you),
    canControl: listen.canControl(s, you),
    canAdd: listen.canAdd(s, you)
  };
}

function broadcast(code: string, s: listen.ListenSession | null, now = Date.now()): void {
  const conns = listenConns.get(code);
  if (!conns) return;
  for (const conn of conns.values()) {
    if (s) send(conn.res, 'state', viewFor(s, conn.userId, now));
    else send(conn.res, 'ended', { code });
  }
}

function endConnsFor(code: string, userId?: string): void {
  const conns = listenConns.get(code);
  if (!conns) return;
  for (const [id, conn] of conns) {
    if (userId === undefined || conn.userId === userId) { conn.res.end(); conns.delete(id); }
  }
  if (!conns.size) listenConns.delete(code);
}

function scheduleLeave(code: string, userId: string): void {
  const k = `${code}\u0000${userId}`;
  clearTimeout(pendingLeave.get(k));
  const timer = setTimeout(() => {
    pendingLeave.delete(k);
    const conns = listenConns.get(code);
    const stillHere = conns && [...conns.values()].some(c => c.userId === userId);
    if (stillHere) return;
    const out = listen.leaveSession(code, userId, Date.now());
    if (out.ok) broadcast(code, out.value.session);
  }, RECONNECT_GRACE_MS);
  timer.unref?.();
  pendingLeave.set(k, timer);
}

function cancelLeave(code: string, userId: string): void {
  const k = `${code}\u0000${userId}`;
  clearTimeout(pendingLeave.get(k));
  pendingLeave.delete(k);
}

/** Sends a device command to every open stream of that device on this account. Returns how many got it. */
function deliver(userId: string, deviceId: string, cmd: devices.DeviceCommand): number {
  let n = 0;
  for (const conn of deviceConns.get(userId)?.values() ?? []) {
    if (conn.deviceId === deviceId) { send(conn.res, 'command', cmd); n++; }
  }
  return n;
}

function broadcastDeviceState(userId: string, deviceId: string, state: devices.DeviceState): void {
  for (const conn of deviceConns.get(userId)?.values() ?? []) send(conn.res, 'state', { deviceId, ...state });
}

export default async function musicTogetherRoutes(server: FastifyInstance) {
  // Ends sessions that sat idle for six hours, and closes their streams.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const code of listen.expireSessions(now)) {
      for (const conn of listenConns.get(code)?.values() ?? []) send(conn.res, 'ended', { code });
      endConnsFor(code);
    }
    devices.purgeDevices(now);
  }, 60_000);
  sweep.unref?.();

  // ---- Listen together ----

  server.post<{ Body: { queue?: unknown; index?: number; position?: number; playing?: boolean } }>('/api/listen', async (request, reply) => {
    const me = currentActor();
    const out = listen.createSession(
      { userId: me.userId, name: me.username },
      { queue: listen.sanitizeQueue(request.body?.queue), index: Number(request.body?.index) || 0, position: Number(request.body?.position) || 0, playing: request.body?.playing !== false },
      Date.now()
    );
    if (!out.ok) return reply.code(out.status).send({ message: out.message });
    return viewFor(out.value, me.userId);
  });

  server.get<{ Params: { code: string } }>('/api/listen/:code', async (request, reply) => {
    const me = currentActor();
    const s = listen.getSession(request.params.code.toUpperCase(), Date.now());
    if (!s) return reply.code(404).send({ message: 'That listening session has ended or the code is wrong.' });
    return viewFor(s, me.userId);
  });

  server.post<{ Params: { code: string } }>('/api/listen/:code/join', async (request, reply) => {
    const me = currentActor();
    const code = request.params.code.toUpperCase();
    const out = listen.joinSession(code, { userId: me.userId, name: me.username }, Date.now());
    if (!out.ok) return reply.code(out.status).send({ message: out.message });
    broadcast(code, out.value);
    return viewFor(out.value, me.userId);
  });

  server.post<{ Params: { code: string } }>('/api/listen/:code/leave', async request => {
    const me = currentActor();
    const code = request.params.code.toUpperCase();
    cancelLeave(code, me.userId);
    endConnsFor(code, me.userId);
    const out = listen.leaveSession(code, me.userId, Date.now());
    if (out.ok) broadcast(code, out.value.session);
    return { ok: true };
  });

  server.post<{ Params: { code: string }; Body: listen.Command }>('/api/listen/:code/command', async (request, reply) => {
    const me = currentActor();
    const code = request.params.code.toUpperCase();
    const body = request.body as listen.Command | undefined;
    if (!body || typeof body !== 'object' || typeof body.type !== 'string') return reply.code(400).send({ message: 'Send a command.' });
    const out = listen.applyCommand(code, me.userId, body, Date.now());
    if (!out.ok) return reply.code(out.status).send({ message: out.message });
    broadcast(code, out.value);
    return { ok: true, seq: out.value.seq };
  });

  server.get<{ Params: { code: string }; Querystring: { client?: string } }>('/api/listen/:code/events', (request, reply) => {
    const me = currentActor();
    const code = request.params.code.toUpperCase();
    const s = listen.getSession(code, Date.now());
    if (!s) return reply.code(404).send({ message: 'That listening session has ended.' });
    if (!listen.isMember(s, me.userId)) return reply.code(403).send({ message: 'Join the listening session first.' });
    const conns = listenConns.get(code) ?? new Map<string, Conn>();
    if (conns.size >= MAX_LISTENERS) return reply.code(429).send({ message: 'This listening session is full.' });
    listenConns.set(code, conns);
    cancelLeave(code, me.userId);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const connId = randomBytes(6).toString('hex');
    conns.set(connId, { userId: me.userId, res });
    s.lastActive = Date.now();
    send(res, 'state', viewFor(s, me.userId));
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(beat);
      conns.delete(connId);
      if (conns.size === 0 && listenConns.get(code) === conns) listenConns.delete(code);
      // Only when this was their last open stream: a second tab keeps them in the session.
      const stillHere = [...(listenConns.get(code)?.values() ?? [])].some(c => c.userId === me.userId);
      if (!stillHere) scheduleLeave(code, me.userId);
    });
  });

  // ---- Play on another device ----

  server.get('/api/devices', async () => ({ devices: devices.listLive(currentActor().userId, Date.now()) }));

  server.post<{ Body: { id?: string; name?: string; state?: unknown } }>('/api/devices/heartbeat', async (request, reply) => {
    const me = currentActor();
    const id = String(request.body?.id ?? '');
    if (!devices.DEVICE_ID.test(id)) return reply.code(400).send({ message: 'Send a device id.' });
    const state = devices.sanitizeState(request.body?.state);
    devices.heartbeat(me.userId, { id, name: request.body?.name, state }, Date.now());
    if (state) broadcastDeviceState(me.userId, id, state);
    return { ok: true };
  });

  server.get<{ Querystring: { device?: string } }>('/api/devices/stream', (request, reply) => {
    const me = currentActor();
    const deviceId = String(request.query.device ?? '');
    if (!devices.DEVICE_ID.test(deviceId)) return reply.code(400).send({ message: 'Send a device id.' });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const conns = deviceConns.get(me.userId) ?? new Map<string, DeviceConn>();
    deviceConns.set(me.userId, conns);
    const connId = randomBytes(6).toString('hex');
    conns.set(connId, { deviceId, res });
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(beat);
      conns.delete(connId);
      if (!conns.size && deviceConns.get(me.userId) === conns) deviceConns.delete(me.userId);
    });
  });

  server.post<{ Params: { id: string }; Body: unknown }>('/api/devices/:id/command', async (request, reply) => {
    const me = currentActor();
    const target = devices.controlTarget(me.userId, request.params.id, Date.now());
    if (!target.ok) return reply.code(target.status).send({ message: target.message });
    const cmd = devices.sanitizeCommand(request.body);
    if (!cmd) return reply.code(400).send({ message: 'That command is not one a device understands.' });
    if (!deliver(me.userId, target.value.id, cmd)) {
      return reply.code(409).send({ message: `${target.value.name} is not listening right now. Open virtuallyView on it and try again.` });
    }
    return { ok: true };
  });
}
