import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { currentActor } from '../services/user-context.js';

interface Room {
  code: string;
  title: string;
  /** Page inside the app that holds the player, such as /movies/radarr-4/play. */
  link: string;
  host: string;
  state: { playing: boolean; position: number; seq: number; from: string };
  clients: Map<string, ServerResponse>;
  createdAt: number;
}

const ROOMS = new Map<string, Room>();
const LIFETIME_MS = 12 * 60 * 60 * 1000;
const MAX_ROOMS = 200;
const MAX_CLIENTS = 25;

function sweep(): void {
  const now = Date.now();
  for (const [code, room] of ROOMS) {
    if (now - room.createdAt > LIFETIME_MS) {
      for (const res of room.clients.values()) res.end();
      ROOMS.delete(code);
    }
  }
}

const newCode = (): string => randomBytes(4).toString('hex').slice(0, 6).toUpperCase();

function send(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Watch together. A room holds one shared play state (playing or paused, and
 * where). Everyone in it sends their own play, pause and seek here, and gets
 * everyone else's over a server-sent event stream. Rooms live in memory and
 * vanish after twelve hours or a restart.
 */
export default async function watchPartyRoutes(server: FastifyInstance) {
  server.post<{ Body: { title?: string; link?: string } }>('/api/watch-party', async (request, reply) => {
    sweep();
    if (ROOMS.size >= MAX_ROOMS) return reply.code(429).send({ message: 'Too many watch parties are open. Try again later.' });
    const link = request.body?.link ?? '';
    // Only pages of this app: a party link must never send people elsewhere.
    if (!/^\/(movies\/[\w-]+\/play|series\/[\w-]+\/watch\/[\w-]+)$/.test(link)) {
      return reply.code(400).send({ message: 'Open a movie or an episode first, then start the watch party from its player.' });
    }
    let code = newCode();
    while (ROOMS.has(code)) code = newCode();
    const room: Room = {
      code, link, title: String(request.body?.title ?? 'A film').slice(0, 120), host: currentActor().username,
      state: { playing: false, position: 0, seq: 0, from: '' }, clients: new Map(), createdAt: Date.now()
    };
    ROOMS.set(code, room);
    return { code, link, title: room.title };
  });

  server.get<{ Params: { code: string } }>('/api/watch-party/:code', async (request, reply) => {
    const room = ROOMS.get(request.params.code.toUpperCase());
    if (!room) return reply.code(404).send({ message: 'That watch party has ended or the code is wrong.' });
    return { code: room.code, title: room.title, link: room.link, host: room.host, state: room.state, watching: room.clients.size };
  });

  server.post<{ Params: { code: string }; Body: { client?: string; playing?: boolean; position?: number } }>('/api/watch-party/:code/state', async (request, reply) => {
    const room = ROOMS.get(request.params.code.toUpperCase());
    if (!room) return reply.code(404).send({ message: 'That watch party has ended.' });
    const position = Number(request.body?.position);
    if (!Number.isFinite(position) || position < 0 || typeof request.body?.playing !== 'boolean') {
      return reply.code(400).send({ message: 'Send playing and position.' });
    }
    room.state = { playing: request.body.playing, position, seq: room.state.seq + 1, from: String(request.body?.client ?? '').slice(0, 40) };
    for (const [id, res] of room.clients) if (id !== room.state.from) send(res, 'state', room.state);
    return { ok: true, seq: room.state.seq };
  });

  server.get<{ Params: { code: string }; Querystring: { client?: string } }>('/api/watch-party/:code/events', (request, reply) => {
    const room = ROOMS.get(request.params.code.toUpperCase());
    if (!room) return reply.code(404).send({ message: 'That watch party has ended.' });
    if (room.clients.size >= MAX_CLIENTS) return reply.code(429).send({ message: 'This watch party is full.' });
    const client = String(request.query.client ?? randomBytes(4).toString('hex')).slice(0, 40);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    room.clients.set(client, res);
    send(res, 'state', room.state);
    for (const other of room.clients.values()) send(other, 'watching', { count: room.clients.size });
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(beat);
      room.clients.delete(client);
      for (const other of room.clients.values()) send(other, 'watching', { count: room.clients.size });
    });
  });
}
