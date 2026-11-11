import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { currentActor } from '../services/user-context.js';
import { listUsers } from '../services/auth.js';
import { allowSend, cleanChat, REACTIONS } from '../services/party-chat.js';
import { resolveStreamable } from './stream.js';

interface Member { userId: string; name: string; avatar: unknown; res: ServerResponse; buffering: boolean }
interface State {
  playing: boolean; position: number; rate: number; seq: number; from: string;
  /** Server clock (ms) at which `position` was true. While playing, now is position + (now - at) * rate. */
  at: number;
  /** Names of members who are buffering; everyone else holds still until the list is empty. */
  waiting: string[];
}
interface Room {
  code: string;
  title: string;
  /** Page inside the app that holds the player, such as /movies/radarr-4/play. */
  link: string;
  /** User id of the host. */
  host: string;
  state: State;
  clients: Map<string, Member>;
  chat: Array<{ id: number; name: string; text: string; at: number }>;
  sent: Map<string, number[]>;
  createdAt: number;
  lastActive: number;
  /** When the last member left (or the room was made with nobody in it yet). */
  emptySince: number | null;
}

const ROOMS = new Map<string, Room>();
const IDLE_MS = 4 * 60 * 60 * 1000;
const EMPTY_GRACE_MS = 2 * 60 * 1000;
const MAX_ROOMS = 200;
const MAX_CLIENTS = 25;
const KEEP_CHAT = 50;

const newCode = (): string => randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
const nowMs = (): number => Date.now();

function send(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(room: Room, event: string, data: unknown, except?: string): void {
  for (const [id, m] of room.clients) if (id !== except) send(m.res, event, data);
}

function endRoom(room: Room): void {
  broadcast(room, 'ended', {});
  for (const m of room.clients.values()) m.res.end();
  ROOMS.delete(room.code);
}

function sweep(): void {
  const now = nowMs();
  for (const room of ROOMS.values()) {
    if (now - room.lastActive > IDLE_MS || (room.emptySince !== null && now - room.emptySince > EMPTY_GRACE_MS)) endRoom(room);
  }
}
setInterval(sweep, 30_000).unref();

/** Where the video is right now, by the server's clock. */
function positionNow(state: State, now: number): number {
  return state.playing && state.waiting.length === 0 ? state.position + ((now - state.at) / 1000) * state.rate : state.position;
}

function members(room: Room) {
  const seen = new Map<string, { id: string; name: string; avatar: unknown; host: boolean }>();
  for (const m of room.clients.values()) if (!seen.has(m.userId)) seen.set(m.userId, { id: m.userId, name: m.name, avatar: m.avatar, host: m.userId === room.host });
  return [...seen.values()];
}
const sendMembers = (room: Room): void => broadcast(room, 'members', { host: room.host, members: members(room) });

/** Someone started or stopped buffering: freeze the shared clock while anyone waits, and tell everyone. */
function syncWaiting(room: Room): void {
  const waiting = [...new Set([...room.clients.values()].filter(m => m.buffering).map(m => m.name))];
  const now = nowMs();
  if (waiting.join('|') === room.state.waiting.join('|')) return;
  const position = positionNow(room.state, now);
  room.state = { ...room.state, position, at: now, waiting, seq: room.state.seq + 1, from: '' };
  broadcast(room, 'state', room.state);
}

/** Kids and other restricted profiles may only be in a party for a title their rating allows. */
async function titleAllowed(link: string): Promise<boolean> {
  const actor = currentActor();
  if (actor.role !== 'user' || !actor.maxRating) return true;
  const id = /^\/(?:movies|series)\/([\w-]+)\//.exec(link)?.[1];
  return !id || !!(await resolveStreamable(id));
}
const REFUSED = { error: 'age_restricted', message: 'This title is above the age limit set for your account.' };

function me() {
  const actor = currentActor();
  return { userId: actor.userId, name: actor.username, avatar: listUsers().find(u => u.id === actor.userId)?.profileAvatar ?? null };
}

/**
 * Watch together. A room holds one shared play state (playing or paused, where, how fast, and when that was true
 * by the server's clock), so every member can work out where the video should be and nudge themselves toward it.
 * Members send play, pause, seek, speed and buffering here and get everyone's over a server-sent event stream,
 * along with the member list and chat. Rooms live in memory: they end when everyone has left, after four idle
 * hours, or on a restart.
 */
export default async function watchPartyRoutes(server: FastifyInstance) {
  // Members measure their clock offset against this with a ping.
  server.get('/api/party-clock', async () => ({ now: nowMs() }));

  server.post<{ Body: { title?: string; link?: string } }>('/api/watch-party', async (request, reply) => {
    sweep();
    if (ROOMS.size >= MAX_ROOMS) return reply.code(429).send({ message: 'Too many watch parties are open. Try again later.' });
    const link = request.body?.link ?? '';
    // Only pages of this app: a party link must never send people elsewhere.
    if (!/^\/(movies\/[\w-]+\/play|series\/[\w-]+\/watch\/[\w-]+|videos\/watch\/[\w-]+)$/.test(link)) {
      return reply.code(400).send({ message: 'Open a film, an episode or a video first, then start the watch party from its player.' });
    }
    if (!(await titleAllowed(link))) return reply.code(403).send(REFUSED);
    let code = newCode();
    while (ROOMS.has(code)) code = newCode();
    const now = nowMs();
    const room: Room = {
      code, link, title: String(request.body?.title ?? 'A film').slice(0, 120), host: currentActor().userId,
      state: { playing: false, position: 0, rate: 1, seq: 0, from: '', at: now, waiting: [] }, clients: new Map(),
      chat: [], sent: new Map(), createdAt: now, lastActive: now, emptySince: now
    };
    ROOMS.set(code, room);
    return { code, link, title: room.title };
  });

  server.get<{ Params: { code: string } }>('/api/watch-party/:code', async (request, reply) => {
    const room = ROOMS.get(request.params.code.toUpperCase());
    if (!room) return reply.code(404).send({ message: 'That watch party has ended or the code is wrong.' });
    if (!(await titleAllowed(room.link))) return reply.code(403).send(REFUSED);
    return { code: room.code, title: room.title, link: room.link, host: room.host, state: room.state, position: positionNow(room.state, nowMs()), watching: room.clients.size };
  });

  server.post<{ Params: { code: string }; Body: { client?: string; playing?: boolean; position?: number; rate?: number } }>('/api/watch-party/:code/state', async (request, reply) => {
    const room = ROOMS.get(request.params.code.toUpperCase());
    if (!room) return reply.code(404).send({ message: 'That watch party has ended.' });
    const position = Number(request.body?.position);
    if (!Number.isFinite(position) || position < 0 || typeof request.body?.playing !== 'boolean') {
      return reply.code(400).send({ message: 'Send playing and position.' });
    }
    const rate = request.body.rate === undefined ? room.state.rate : Number(request.body.rate);
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) return reply.code(400).send({ message: 'Speed must be between 0.25 and 4.' });
    const now = nowMs();
    room.lastActive = now;
    room.state = { ...room.state, playing: request.body.playing, position, rate, at: now, seq: room.state.seq + 1, from: String(request.body?.client ?? '').slice(0, 40) };
    broadcast(room, 'state', room.state, room.state.from);
    return { ok: true, seq: room.state.seq };
  });

  server.post<{ Params: { code: string }; Body: { client?: string; buffering?: boolean } }>('/api/watch-party/:code/buffering', async (request, reply) => {
    const room = ROOMS.get(request.params.code.toUpperCase());
    const member = room?.clients.get(String(request.body?.client ?? ''));
    if (!room || !member) return reply.code(404).send({ message: 'That watch party has ended.' });
    member.buffering = request.body?.buffering === true;
    syncWaiting(room);
    return { ok: true };
  });

  server.post<{ Params: { code: string }; Body: { client?: string; text?: unknown; reaction?: string } }>('/api/watch-party/:code/chat', async (request, reply) => {
    const room = ROOMS.get(request.params.code.toUpperCase());
    const member = room?.clients.get(String(request.body?.client ?? ''));
    if (!room || !member) return reply.code(404).send({ message: 'That watch party has ended.' });
    const stamps = room.sent.get(member.userId) ?? [];
    room.sent.set(member.userId, stamps);
    if (request.body?.reaction !== undefined) {
      if (!REACTIONS.includes(request.body.reaction)) return reply.code(400).send({ message: 'Pick one of the quick reactions.' });
      if (!allowSend(stamps, nowMs(), 12, 10_000)) return reply.code(429).send({ message: 'Slow down a little.' });
      broadcast(room, 'reaction', { name: member.name, emoji: request.body.reaction });
      return { ok: true };
    }
    const text = cleanChat(request.body?.text);
    if (!text) return reply.code(400).send({ message: 'Type a message first.' });
    if (!allowSend(stamps, nowMs(), 5, 10_000)) return reply.code(429).send({ message: 'Slow down a little.' });
    room.lastActive = nowMs();
    const message = { id: (room.chat.at(-1)?.id ?? 0) + 1, name: member.name, text, at: nowMs() };
    room.chat.push(message);
    if (room.chat.length > KEEP_CHAT) room.chat.shift();
    broadcast(room, 'chat', message);
    return { ok: true };
  });

  // The host hands host over to someone else in the party.
  server.post<{ Params: { code: string }; Body: { to?: string } }>('/api/watch-party/:code/host', async (request, reply) => {
    const room = ROOMS.get(request.params.code.toUpperCase());
    if (!room) return reply.code(404).send({ message: 'That watch party has ended.' });
    if (currentActor().userId !== room.host) return reply.code(403).send({ message: 'Only the host can hand over.' });
    const target = [...room.clients.values()].find(m => m.userId === request.body?.to);
    if (!target) return reply.code(404).send({ message: 'That person is not in the party.' });
    room.host = target.userId;
    sendMembers(room);
    return { ok: true };
  });

  server.get<{ Params: { code: string }; Querystring: { client?: string } }>('/api/watch-party/:code/events', async (request, reply) => {
    const room = ROOMS.get(request.params.code.toUpperCase());
    if (!room) return reply.code(404).send({ message: 'That watch party has ended.' });
    if (!(await titleAllowed(room.link))) return reply.code(403).send(REFUSED);
    if (room.clients.size >= MAX_CLIENTS) return reply.code(429).send({ message: 'This watch party is full.' });
    const client = String(request.query.client ?? randomBytes(4).toString('hex')).slice(0, 40);
    const who = me();
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    room.clients.set(client, { ...who, res, buffering: false });
    room.emptySince = null;
    room.lastActive = nowMs();
    send(res, 'hello', { you: who.userId });
    // A joiner is handed the position as it is right now, not as it was when it was last set.
    send(res, 'state', { ...room.state, position: positionNow(room.state, nowMs()), at: nowMs() });
    for (const message of room.chat) send(res, 'chat', message);
    sendMembers(room);
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(beat);
      room.clients.delete(client);
      if (room.clients.size === 0) { room.emptySince = nowMs(); return; }
      // The host leaving hands host to whoever has been here longest.
      if (![...room.clients.values()].some(m => m.userId === room.host)) room.host = room.clients.values().next().value!.userId;
      sendMembers(room);
      syncWaiting(room);
    });
  });
}
