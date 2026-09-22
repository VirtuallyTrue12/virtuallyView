import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import { WEB_DIST_DIR } from './lib/paths.js';
import dashboardRoutes from './routes/dashboard.js';
import mediaRoutes from './routes/media.js';
import downloadsRoutes from './routes/downloads.js';
import aiRoutes from './routes/ai.js';
import requestsRoutes from './routes/requests.js';
import integrationsRoutes from './routes/integrations.js';
import streamRoutes from './routes/stream.js';
import themesRoutes from './routes/themes.js';
import serviceLaunchRoutes from './routes/service-launch.js';
import activityRoutes from './routes/activity.js';
import progressRoutes from './routes/progress.js';
import serverSettingsRoutes from './routes/server-settings.js';
import musicRoutes from './routes/music.js';
import playlistRoutes from './routes/playlists.js';
import artistCoversRoutes from './routes/artist-covers.js';
import searchRoutes from './routes/search.js';
import diagnosticsRoutes from './routes/diagnostics.js';
import systemRoutes from './routes/system.js';
import userDataRoutes from './routes/user-data.js';
import notificationRoutes from './routes/notifications.js';
import indexerRoutes from './routes/indexers.js';
import backupRoutes from './routes/backup.js';
import lyricsRoutes from './routes/lyrics.js';
import subtitleRoutes from './routes/subtitles.js';
import watchPartyRoutes from './routes/watch-party.js';
import peopleRoutes from './routes/people.js';
import castRoutes from './routes/cast.js';
import liveRoutes from './routes/live.js';
import libraryFolderRoutes from './routes/library-folders.js';
import artRoutes from './routes/art.js';
import setupRoutes from './routes/setup.js';
import { startAutoBackup } from './services/backup.js';
import { startRequestSync } from './services/requests.js';
import { getAuthBackdrop } from './services/backdrop.js';
import { getServerSettings } from './services/server-settings.js';
import { runAsActor } from './services/user-context.js';
import { notify } from './services/notifications.js';
import {
  authenticate,
  authEnabled,
  createAccount,
  currentUser,
  deleteUser,
  isAdmin,
  isAuthenticated,
  listUsers,
  readSessionCookie,
  revoke,
  changeOwnPassword,
  listSessions,
  revokeOtherSessions,
  revokeSessionById,
  setUserPassword,
  setUserRole,
  setupRequired,
  issueSession,
  updateProfile,
  type Role
} from './services/auth.js';
import { verifyStreamToken, signStreamPath, isStreamPath, shareOrigin } from './services/stream-token.js';
import { startQuickConnect, pollQuickConnect, approveQuickConnect } from './services/quick-connect.js';

const server = Fastify({ logger: true, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
const rateWindowMs = 60_000;
// Counts API calls per address. Pages, assets and media streams are exempt:
// a video makes hundreds of range requests and a household shares one address.
const rateLimit = Number(process.env.API_RATE_LIMIT ?? 1500);
const loginRateLimit = Number(process.env.LOGIN_RATE_LIMIT ?? 30);
const loginCounts = new Map<string, { started: number; count: number }>();
const requestCounts = new Map<string, { started: number; count: number }>();
const metrics = { requests: 0, errors: 0, timeouts: 0, startedAt: new Date().toISOString() };

/** Session cookie; marked Secure whenever the request arrived over HTTPS (directly or via a reverse proxy). */
function sessionCookie(token: string, maxAge: number, secure: boolean): string {
  return `vv_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function deviceLabel(ua: string | undefined): string {
  const agent = ua ?? '';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
  const os = /Android/.test(agent) ? 'Android' : /iPhone|iPad|iOS/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Mac OS X/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

server.get('/api/health', async () => ({ status: 'ok', version: '1.0.0' }));
server.get('/api/metrics', async () => ({ ...metrics, uptimeSeconds: Math.round(process.uptime()) }));
server.get('/api/auth/status', async request => {
  const token = readSessionCookie(request.headers.cookie);
  return {
    enabled: authEnabled(),
    setupRequired: setupRequired(),
    signupOpen: setupRequired() || getServerSettings().allowSignup,
    authenticated: isAuthenticated(token),
    user: currentUser(token)
  };
});
server.post<{ Body: { username?: string; password?: string; stayLoggedIn?: boolean } }>('/api/auth/login', async (request, reply) => {
  const stayLoggedIn = request.body?.stayLoggedIn === true;
  const token = authenticate(request.body?.username?.trim() ?? '', request.body?.password ?? '', stayLoggedIn, { device: deviceLabel(request.headers['user-agent']), ip: request.ip });
  if (!token) return reply.code(401).send({ message: 'Invalid username or password.' });
  const maxAge = stayLoggedIn ? 30 * 24 * 60 * 60 : 86400;
  reply.header('Set-Cookie', sessionCookie(token, maxAge, request.protocol === 'https'));
  return { enabled: true, authenticated: true, stayLoggedIn, user: currentUser(token) };
});
server.post<{ Body: { username?: string; password?: string; stayLoggedIn?: boolean } }>('/api/auth/signup', async (request, reply) => {
  if (!setupRequired() && !getServerSettings().allowSignup) {
    return reply.code(403).send({ message: 'Sign-up is closed. Ask the administrator to create an account for you.' });
  }
  const username = request.body?.username ?? '';
  const password = request.body?.password ?? '';
  const created = createAccount(username, password);
  if (!created.ok) return reply.code(400).send({ message: created.message });
  const stayLoggedIn = request.body?.stayLoggedIn === true;
  const token = authenticate(username.trim(), password, stayLoggedIn, { device: deviceLabel(request.headers['user-agent']), ip: request.ip });
  if (!token) return reply.code(500).send({ message: 'Account was created but could not be signed in.' });
  if (!setupRequired()) notify({ type: 'user.signup', role: 'admin', title: `${username.trim()} created an account`, link: '/settings?cat=users' });
  const maxAge = stayLoggedIn ? 30 * 24 * 60 * 60 : 86400;
  reply.header('Set-Cookie', sessionCookie(token, maxAge, request.protocol === 'https'));
  return { enabled: true, authenticated: true, stayLoggedIn, user: currentUser(token) };
});
server.post('/api/auth/logout', async (request, reply) => {
  revoke(readSessionCookie(request.headers.cookie));
  reply.header('Set-Cookie', sessionCookie('', 0, request.protocol === 'https'));
  return { authenticated: false };
});

// Quick Connect: sign in a TV or phone by typing a short code on a device that
// is already signed in. start and poll are public; approve needs a session.
server.post('/api/auth/quickconnect/start', async (request, reply) => {
  const started = startQuickConnect(deviceLabel(request.headers['user-agent']));
  if (!started) return reply.code(429).send({ message: 'Too many sign-ins waiting. Try again in a few minutes.' });
  return started;
});
server.get<{ Querystring: { secret?: string } }>('/api/auth/quickconnect/poll', async (request, reply) => {
  const polled = pollQuickConnect(request.query.secret ?? '');
  if (polled.status !== 'approved') return polled;
  const token = issueSession(polled.userId, true, { device: deviceLabel(request.headers['user-agent']), ip: request.ip });
  if (!token) return { status: 'expired' };
  reply.header('Set-Cookie', sessionCookie(token, 30 * 24 * 60 * 60, request.protocol === 'https'));
  return { status: 'approved', user: currentUser(token) };
});
server.post<{ Body: { code?: string } }>('/api/auth/quickconnect/approve', async (request, reply) => {
  const me = currentUser(readSessionCookie(request.headers.cookie));
  if (!me) return reply.code(401).send({ message: 'Authentication required.' });
  const result = approveQuickConnect(request.body?.code ?? '', me.id);
  if (!result.ok) return reply.code(400).send({ message: result.message });
  return { ok: true, device: result.device ?? 'the other device' };
});

// Profile picture (own account) and age limit (administrator).
server.post<{ Body: { avatar?: string } }>('/api/auth/profile/avatar', async (request, reply) => {
  const me = currentUser(readSessionCookie(request.headers.cookie));
  if (!me) return reply.code(401).send({ message: 'Authentication required.' });
  const result = updateProfile(me.id, { avatar: request.body?.avatar ?? '' });
  if (!result.ok) return reply.code(400).send({ message: result.message });
  return { user: currentUser(readSessionCookie(request.headers.cookie)) };
});
server.post<{ Params: { id: string }; Body: { maxRating?: string } }>('/api/auth/users/:id/limit', async (request, reply) => {
  if (!isAdmin(readSessionCookie(request.headers.cookie))) {
    return reply.code(403).send({ message: 'Administrator access required.' });
  }
  const result = updateProfile(request.params.id, { maxRating: request.body?.maxRating ?? '' });
  if (!result.ok) return reply.code(400).send({ message: result.message });
  return { users: listUsers() };
});

// Signed link for a TV or cast receiver: play one path as the signed-in person, without a cookie.
server.post<{ Body: { path?: string } }>('/api/stream-token', async (request, reply) => {
  const me = currentUser(readSessionCookie(request.headers.cookie));
  if (!me) return reply.code(401).send({ message: 'Authentication required.' });
  const path = String(request.body?.path ?? '').split('?')[0] ?? '';
  if (!isStreamPath(path)) return reply.code(400).send({ message: 'Only playback links can be signed.' });
  return { token: signStreamPath(path, me.id), origin: shareOrigin(request.headers.host, request.protocol) };
});

// Public: artwork for the cinematic sign-in screen. Runs before authentication,
// so it exposes nothing beyond cover art the library already surfaces.
server.get('/api/auth/backdrop', async () => ({ backdrop: await getAuthBackdrop() }));

// Administrator-only account management. These live under /api/auth/ (which the
// global auth gate skips), so each handler enforces the admin role itself.
server.get('/api/auth/users', async (request, reply) => {
  if (!isAdmin(readSessionCookie(request.headers.cookie))) {
    return reply.code(403).send({ message: 'Administrator access required.' });
  }
  return { users: listUsers() };
});
server.post<{ Body: { username?: string; password?: string; role?: string } }>('/api/auth/users', async (request, reply) => {
  if (!isAdmin(readSessionCookie(request.headers.cookie))) {
    return reply.code(403).send({ message: 'Administrator access required.' });
  }
  const role: Role = request.body?.role === 'admin' ? 'admin' : 'user';
  const created = createAccount(request.body?.username ?? '', request.body?.password ?? '', role);
  if (!created.ok) return reply.code(400).send({ message: created.message });
  return { users: listUsers() };
});
server.post<{ Params: { id: string }; Body: { role?: string } }>('/api/auth/users/:id/role', async (request, reply) => {
  if (!isAdmin(readSessionCookie(request.headers.cookie))) {
    return reply.code(403).send({ message: 'Administrator access required.' });
  }
  const result = setUserRole(request.params.id, request.body?.role === 'admin' ? 'admin' : 'user');
  if (!result.ok) return reply.code(400).send({ message: result.message });
  return { users: listUsers() };
});
server.delete<{ Params: { id: string } }>('/api/auth/users/:id', async (request, reply) => {
  const me = currentUser(readSessionCookie(request.headers.cookie));
  if (!me || me.role !== 'admin') {
    return reply.code(403).send({ message: 'Administrator access required.' });
  }
  if (me.id === request.params.id) {
    return reply.code(400).send({ message: 'You cannot remove the account you are signed in with.' });
  }
  const result = deleteUser(request.params.id);
  if (!result.ok) return reply.code(400).send({ message: result.message });
  return { users: listUsers() };
});
server.post<{ Params: { id: string }; Body: { password?: string } }>('/api/auth/users/:id/password', async (request, reply) => {
  if (!isAdmin(readSessionCookie(request.headers.cookie))) {
    return reply.code(403).send({ message: 'Administrator access required.' });
  }
  const result = setUserPassword(request.params.id, request.body?.password ?? '');
  if (!result.ok) return reply.code(400).send({ message: result.message });
  return { ok: true };
});
server.post<{ Body: { current?: string; next?: string } }>('/api/auth/password', async (request, reply) => {
  const token = readSessionCookie(request.headers.cookie);
  const me = currentUser(token);
  if (!me) return reply.code(401).send({ message: 'Authentication required.' });
  const result = changeOwnPassword(me.id, request.body?.current ?? '', request.body?.next ?? '', token);
  if (!result.ok) return reply.code(400).send({ message: result.message });
  return { ok: true };
});
server.get('/api/auth/sessions', async (request, reply) => {
  const token = readSessionCookie(request.headers.cookie);
  const me = currentUser(token);
  if (!me) return reply.code(401).send({ message: 'Authentication required.' });
  return { sessions: listSessions(me.id, me.role === 'admin', token) };
});
server.post('/api/auth/sessions/revoke-others', async (request, reply) => {
  const token = readSessionCookie(request.headers.cookie);
  const me = currentUser(token);
  if (!me || !token) return reply.code(401).send({ message: 'Authentication required.' });
  return { ok: true, signedOut: revokeOtherSessions(me.id, token) };
});
server.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', async (request, reply) => {
  const me = currentUser(readSessionCookie(request.headers.cookie));
  if (!me) return reply.code(401).send({ message: 'Authentication required.' });
  if (!revokeSessionById(request.params.id, me.id, me.role === 'admin')) {
    return reply.code(404).send({ message: 'Session not found.' });
  }
  return { ok: true };
});

// Everything below runs as the signed-in user, so per-user data (watch
// progress, My List) resolves without threading a user id through every call.
server.addHook('onRequest', (request, _reply, done) => {
  let user = currentUser(readSessionCookie(request.headers.cookie));
  // A cast receiver has no cookie: a signed link stands in for the person who made it.
  if (!user && request.method === 'GET') {
    const [pathname = '', query = ''] = request.url.split('?');
    const owner = verifyStreamToken(new URLSearchParams(query).get('st') ?? undefined, pathname);
    if (owner) user = listUsers().find(u => u.id === owner) ?? null;
  }
  runAsActor(user ? { userId: user.id, username: user.username, role: user.role, ...(user.maxRating ? { maxRating: user.maxRating } : {}) } : { userId: 'shared', username: 'guest', role: 'user' }, done);
});

// Regular users may watch, request and manage their own lists; anything that
// reconfigures the server or its services is administrator-only.
const ADMIN_ONLY_WRITE = [
  '/api/server-settings', '/api/integrations', '/api/services', '/api/onboarding', '/api/downloads/',
  '/api/themes', '/api/ai/pull', '/api/ai/permissions', '/api/system', '/api/library', '/api/quality', '/api/notifications/test', '/api/indexers', '/api/backup', '/api/live/playlists', '/api/setup/'
];
server.addHook('preHandler', async (request, reply) => {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
  const path = request.url.split('?')[0] ?? '';
  const adminOnly = ADMIN_ONLY_WRITE.some(prefix => path.startsWith(prefix)) ||
    (request.method === 'DELETE' && /^\/api\/(movies|series|artists)\//.test(path)) ||
    /^\/api\/movies\/[^/]+\/replace-file$/.test(path);
  if (!adminOnly) return;
  const me = currentUser(readSessionCookie(request.headers.cookie));
  if (me && me.role !== 'admin') {
    return reply.code(403).send({ message: 'Only an administrator can do that.' });
  }
});

server.addHook('preHandler', async (request, reply) => {
  metrics.requests++;
  const path = request.url.split('?')[0] ?? '';
  const now = Date.now();
  const bump = (map: Map<string, { started: number; count: number }>) => {
    const current = map.get(request.ip);
    const bucket = !current || now - current.started >= rateWindowMs
      ? { started: now, count: 1 }
      : { ...current, count: current.count + 1 };
    map.set(request.ip, bucket);
    return bucket.count;
  };
  // Password guessing is limited tightly per address.
  if (request.method === 'POST' && (path === '/api/auth/login' || path === '/api/auth/signup' || path === '/api/auth/quickconnect/start' || path === '/api/auth/quickconnect/approve') && bump(loginCounts) > loginRateLimit) {
    return reply.code(429).header('Retry-After', '60').send({ error: 'rate_limited', message: 'Too many sign-in attempts. Wait a minute and try again.' });
  }
  const exempt = !path.startsWith('/api/') || path.startsWith('/api/stream/') || path.startsWith('/api/music/stream/') || path.startsWith('/api/live/relay') || path.startsWith('/api/photos/') || path.startsWith('/api/art');
  if (!exempt && bump(requestCounts) > rateLimit) {
    return reply.code(429).header('Retry-After', '60').send({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' });
  }
  if (!request.url.startsWith('/api/') || request.url.startsWith('/api/auth/') || request.url === '/api/auth/status') return;
  // Health and metrics stay public so uptime monitors and container
  // healthchecks work without a dashboard session. They expose no
  // library or configuration data.
  if (request.url === '/api/health' || request.url === '/api/metrics') return;
  if (!isAuthenticated(readSessionCookie(request.headers.cookie))) {
    const [pathname = '', query = ''] = request.url.split('?');
    if (request.method === 'GET' && verifyStreamToken(new URLSearchParams(query).get('st') ?? undefined, pathname)) return;
    return reply.code(401).send({ message: 'Authentication required.' });
  }
});
server.setErrorHandler((error, request, reply) => {
  metrics.errors++;
  const err = error as { code?: string; statusCode?: number; message?: string };
  if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return reply.code(413).send({ error: 'payload_too_large', message: 'Request body is too large.' });
  }
  request.log.error({ err: error, url: request.url }, 'request failed');
  return reply.code(err.statusCode ?? 500).send({ error: 'request_failed', message: err.statusCode ? err.message : 'Internal server error.' });
});

const start = async () => {
  await server.register(dashboardRoutes);
  await server.register(mediaRoutes);
  await server.register(downloadsRoutes);
  await server.register(aiRoutes);
  await server.register(requestsRoutes);
  await server.register(integrationsRoutes);
  await server.register(streamRoutes);
  await server.register(themesRoutes);
  await server.register(serviceLaunchRoutes);
  await server.register(activityRoutes);
  await server.register(progressRoutes);
  await server.register(serverSettingsRoutes);
  await server.register(musicRoutes);
  await server.register(lyricsRoutes);
  await server.register(subtitleRoutes);
  await server.register(watchPartyRoutes);
  await server.register(peopleRoutes);
  await server.register(castRoutes);
  await server.register(liveRoutes);
  await server.register(libraryFolderRoutes);
  await server.register(artRoutes);
  await server.register(setupRoutes);
  await server.register(playlistRoutes);
  await server.register(artistCoversRoutes);
  await server.register(searchRoutes);
  await server.register(diagnosticsRoutes);
  await server.register(systemRoutes);
  await server.register(userDataRoutes);
  await server.register(notificationRoutes);
  await server.register(indexerRoutes);
  await server.register(backupRoutes);

  // In production (Docker, `npm start`) the built web app ships alongside the
  // server, so one process serves both the API and the UI on one port. In
  // local dev, apps/web/dist won't exist yet - Vite serves the UI on :3001
  // instead and proxies /api here, so this is skipped without side effects.
  if (existsSync(WEB_DIST_DIR)) {
    await server.register(fastifyStatic, {
      root: WEB_DIST_DIR,
      // Sends the .br or .gz copy written at build time when the browser accepts it.
      preCompressed: true,
      cacheControl: false,
      setHeaders: (res, filePath) => {
        // Files under /assets carry a content hash in their name, so they never
        // change: cache them for a year. The page itself is always re-checked so
        // a new release shows up on the next load.
        if (/[\\/]assets[\\/]/.test(filePath)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else if (filePath.endsWith('.html')) res.header('Cache-Control', 'no-cache');
        else res.header('Cache-Control', 'public, max-age=86400');
      }
    });
    server.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api')) {
        return reply.code(404).send({ error: 'not_found', message: `No route matches ${request.raw.url}.` });
      }
      return reply.sendFile('index.html');
    });
  }

  startRequestSync();
  startAutoBackup();
  try {
    const port = Number(process.env.PORT ?? 3000);
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();