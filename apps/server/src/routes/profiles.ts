import type { FastifyInstance } from 'fastify';
import { currentUser, listUsers, readSessionCookie, updateAccountProfile } from '../services/auth.js';
import { pickerProfiles, switchProfile } from '../services/profiles.js';
import { recordChange } from '../services/settings-history.js';

/** Same cookie as the sign-in routes in index.ts: HttpOnly, Lax, Secure only over HTTPS. */
function sessionCookie(token: string, maxAge: number, secure: boolean): string {
  return `vv_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** A short device name for the signed-in devices list, matching the sign-in routes. */
function deviceLabel(ua: string | undefined): string {
  const agent = ua ?? '';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
  const os = /Android/.test(agent) ? 'Android' : /iPhone|iPad|iOS/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Mac OS X/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

/**
 * Household profiles: the "Who's watching?" picker and switching between accounts without a password.
 * Every route here needs a signed-in session (the global gate in index.ts). The PIN and its hash are never returned.
 */
export default async function profileRoutes(server: FastifyInstance) {
  server.get('/api/profiles', async request => {
    const me = currentUser(readSessionCookie(request.headers.cookie));
    return { profiles: pickerProfiles(), currentId: me?.id ?? null };
  });

  server.post<{ Body: { id?: string; pin?: string; password?: string } }>('/api/profiles/switch', async (request, reply) => {
    const token = readSessionCookie(request.headers.cookie);
    const body = request.body ?? {};
    const result = switchProfile(token, { targetId: body.id ?? '', pin: body.pin, password: body.password }, {
      device: deviceLabel(request.headers['user-agent']), ip: request.ip
    });
    if (!result.ok) {
      if (result.retryAfterSeconds) reply.header('Retry-After', String(result.retryAfterSeconds));
      return reply.code(result.status).send({
        message: result.message,
        ...(result.needs ? { needs: result.needs } : {}),
        ...(result.passwordAllowed ? { passwordAllowed: true } : {}),
        ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
        ...(result.attemptsLeft !== undefined ? { attemptsLeft: result.attemptsLeft } : {})
      });
    }
    const maxAge = result.stayLoggedIn ? 30 * 24 * 60 * 60 : 86400;
    reply.header('Set-Cookie', sessionCookie(result.token, maxAge, request.protocol === 'https'));
    return { authenticated: true, user: currentUser(result.token) };
  });

  // Your own profile: colour and emoji, and your PIN (4 digits; null or "" removes it).
  server.put<{ Body: { avatar?: unknown; pin?: unknown } }>('/api/profiles/me', async (request, reply) => {
    const token = readSessionCookie(request.headers.cookie);
    const me = currentUser(token);
    if (!me) return reply.code(401).send({ message: 'Authentication required.' });
    const body = request.body ?? {};
    if (body.pin !== undefined && body.pin !== null && typeof body.pin !== 'string') {
      return reply.code(400).send({ message: 'A PIN is exactly 4 digits.' });
    }
    const result = updateAccountProfile(me.id, {
      ...(body.avatar !== undefined ? { profileAvatar: body.avatar } : {}),
      ...(body.pin !== undefined ? { pin: typeof body.pin === 'string' && body.pin !== '' ? body.pin : null } : {})
    });
    if (!result.ok) return reply.code(400).send({ message: result.message });
    return { user: currentUser(token) };
  });

  // Administrators: picker visibility, Kids mode and colour/emoji for any account.
  server.put<{ Params: { id: string }; Body: { avatar?: unknown; shown?: unknown; isKid?: unknown } }>('/api/profiles/:id', async (request, reply) => {
    const me = currentUser(readSessionCookie(request.headers.cookie));
    if (!me || me.role !== 'admin') return reply.code(403).send({ message: 'Administrator access required.' });
    const body = request.body ?? {};
    if (body.shown !== undefined && typeof body.shown !== 'boolean') return reply.code(400).send({ message: 'Shown must be on or off.' });
    if (body.isKid !== undefined && typeof body.isKid !== 'boolean') return reply.code(400).send({ message: 'Kids mode must be on or off.' });
    const result = updateAccountProfile(request.params.id, {
      ...(body.shown !== undefined ? { shown: body.shown as boolean } : {}),
      ...(body.isKid !== undefined ? { isKid: body.isKid as boolean } : {}),
      ...(body.avatar !== undefined ? { profileAvatar: body.avatar } : {})
    });
    if (!result.ok) return reply.code(400).send({ message: result.message });
    recordChange('People', 'A profile was changed (picker, Kids mode or colour)');
    return { users: listUsers() };
  });
}
