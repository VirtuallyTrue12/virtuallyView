#!/usr/bin/env node
/**
 * virtuallyView open-folder helper: runs directly on your computer (not in a
 * container - Docker/Podman has no access to your desktop's GUI), so the
 * "Open" button in the dashboard can pop your library folders open in your
 * normal file manager. Only works when you browse the dashboard from this
 * same computer; opt-in, see docs/existing-media.md.
 *
 * Deliberately narrow: it only ever opens one of the exact MOVIES_DIR/TV_DIR/
 * MUSIC_DIR/PHOTOS_DIR/BOOKS_DIR paths read from .env at startup, never an
 * arbitrary path, and only answers requests whose Origin is localhost itself.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 3998;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN_OK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function loadEnvDirs() {
  let text = '';
  try { text = readFileSync(resolve(ROOT, '.env'), 'utf8'); } catch { return new Set(); }
  const dirs = new Set();
  for (const line of text.split('\n')) {
    const m = /^\s*(MOVIES_DIR|TV_DIR|MUSIC_DIR|PHOTOS_DIR|BOOKS_DIR)\s*=\s*(.+?)\s*$/.exec(line);
    if (m) dirs.add(resolve(ROOT, m[2].replace(/^["']|["']$/g, '')));
  }
  return dirs;
}

function opener() {
  if (process.platform === 'darwin') return 'open';
  if (process.platform === 'win32') return 'explorer';
  return 'xdg-open';
}

const send = (res, code, body, origin) => {
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
  const origin = ORIGIN_OK.test(req.headers.origin ?? '') ? req.headers.origin : undefined;
  if (req.method === 'OPTIONS') {
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); }
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/open' || !origin) return send(res, origin ? 404 : 403, { message: 'Not allowed.' }, origin);

  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let path;
    try { path = JSON.parse(body).path; } catch { return send(res, 400, { message: 'Bad request.' }, origin); }
    if (!loadEnvDirs().has(path)) return send(res, 400, { message: 'That is not one of this computer’s configured library folders.' }, origin);
    const child = spawn(opener(), [path], { detached: true, stdio: 'ignore' });
    child.once('error', err => send(res, 500, { message: err.message }, origin));
    child.once('spawn', () => { child.unref(); send(res, 200, { ok: true }, origin); });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`open-folder helper listening on 127.0.0.1:${PORT}`));
