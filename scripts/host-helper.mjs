#!/usr/bin/env node
/**
 * virtuallyView host helper: the one small piece that is allowed to start and
 * stop containers, so the dashboard itself never needs Docker access.
 *
 * It is opt-in (docker compose --profile helper up -d) and deliberately narrow:
 * it can only start, stop and restart an allowlist of the stack's own
 * containers, only for this Compose project, and only for a caller that holds
 * the token it generates into a volume shared with the app. It cannot create
 * containers, run commands, mount anything or touch other projects.
 */
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const SOCKET = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock';
const PORT = Number(process.env.HELPER_PORT ?? 8099);
const TOKEN_FILE = process.env.HELPER_TOKEN_FILE ?? '/shared/token';
const ALLOWED = new Set([
  'radarr', 'sonarr', 'prowlarr', 'lidarr', 'bazarr', 'qbittorrent', 'nzbget', 'flaresolverr',
  'ollama', 'tor', 'kiwix', 'audiobookshelf', 'kavita', 'immich-server', 'immich-machine-learning',
  'gluetun', 'vpngate-config', 'ytdlp', 'watchtower'
]);
const ACTIONS = new Set(['start', 'stop', 'restart']);

function docker(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, method, path, timeout: 30000 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('the container engine did not answer')));
    req.end();
  });
}

async function project() {
  if (process.env.COMPOSE_PROJECT) return process.env.COMPOSE_PROJECT;
  const self = await docker('GET', `/containers/${encodeURIComponent(os.hostname())}/json`);
  const label = JSON.parse(self.body)?.Config?.Labels?.['com.docker.compose.project'];
  if (!label) throw new Error('could not tell which Compose project this helper belongs to');
  return label;
}

async function containers() {
  const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${await project()}`] }));
  const res = await docker('GET', `/containers/json?all=true&filters=${filters}`);
  return JSON.parse(res.body).map(c => ({
    id: c.Id,
    service: c.Labels?.['com.docker.compose.service'],
    state: c.State,
    status: c.Status
  })).filter(c => ALLOWED.has(c.service));
}

function token() {
  if (!existsSync(TOKEN_FILE)) {
    mkdirSync(TOKEN_FILE.replace(/\/[^/]*$/, ''), { recursive: true });
    writeFileSync(TOKEN_FILE, randomBytes(32).toString('hex'), { mode: 0o644 });
  }
  return readFileSync(TOKEN_FILE, 'utf8').trim();
}

const expected = token();
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return send(res, 401, { message: 'Not allowed.' });
  try {
    const url = new URL(req.url ?? '/', 'http://helper');
    if (req.method === 'GET' && url.pathname === '/status') {
      return send(res, 200, { services: (await containers()).map(({ service, state, status }) => ({ service, state, status })) });
    }
    const action = /^\/service\/([a-z0-9-]+)\/(start|stop|restart)$/.exec(url.pathname);
    if (req.method === 'POST' && action) {
      const [, service, verb] = action;
      if (!ALLOWED.has(service) || !ACTIONS.has(verb)) return send(res, 400, { message: 'That service cannot be controlled here.' });
      const target = (await containers()).find(c => c.service === service);
      if (!target) return send(res, 404, { message: `${service} is not part of this stack (or its profile is not on).` });
      const r = await docker('POST', `/containers/${target.id}/${verb}${verb === 'start' ? '' : '?t=10'}`);
      // 304 means it was already in that state, which is fine.
      return send(res, r.status < 300 || r.status === 304 ? 200 : 502, { ok: r.status < 300 || r.status === 304, service, action: verb });
    }
    if (req.method === 'POST' && url.pathname === '/start-all') {
      const stopped = (await containers()).filter(c => c.state !== 'running');
      for (const c of stopped) await docker('POST', `/containers/${c.id}/start`);
      return send(res, 200, { ok: true, started: stopped.map(c => c.service) });
    }
    return send(res, 404, { message: 'Not found.' });
  } catch (err) {
    return send(res, 500, { message: err instanceof Error ? err.message : 'Failed.' });
  }
}).listen(PORT, '0.0.0.0', () => console.log(`helper listening on ${PORT}`));
