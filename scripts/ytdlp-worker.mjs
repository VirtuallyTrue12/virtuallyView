#!/usr/bin/env node
/**
 * virtuallyView YouTube worker (optional: docker compose --profile youtube up -d).
 *
 * A small service that only the dashboard talks to. It searches YouTube and
 * downloads one video at a time into an artist's Concerts or Videos folder,
 * using yt-dlp. It is deliberately narrow: it takes a YouTube video id (never a
 * web address), writes only inside the music library, and answers only to the
 * token the dashboard shares with it. Nothing here runs on its own.
 */
import http from 'node:http';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.YTDLP_PORT ?? 8098);
const LIBRARY = path.resolve(process.env.YTDLP_LIBRARY ?? '/media/music');
const TOKEN_FILE = process.env.YTDLP_TOKEN_FILE ?? '/secrets/ytdlp';
const BINARY = process.env.YTDLP_BIN ?? 'yt-dlp';
const PROXY = process.env.YTDLP_PROXY ?? '';
const MAX_PARALLEL = 2;

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** A folder the person's library owns: inside the music library, never the library root, no way out with "..". */
export function safeDestination(dir) {
  if (typeof dir !== 'string' || !dir) return null;
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(`${LIBRARY}${path.sep}`)) return null;
  const relative = path.relative(LIBRARY, resolved).split(path.sep);
  // <artist>/<Concerts|Videos>[/...]
  if (relative.length < 2 || !['Concerts', 'Videos'].includes(relative[1])) return null;
  return resolved;
}

export function downloadArgs(id, dir) {
  return [
    '--no-playlist', '--no-warnings', '--newline', '--js-runtimes', 'node',
    // Up to 1080p, preferring H.264 + AAC so the file plays in any browser without conversion.
    '-S', 'res:1080,vcodec:h264,acodec:aac,ext:mp4:m4a', '--merge-output-format', 'mp4',
    '--embed-metadata', '--windows-filenames', '--concurrent-fragments', '4', '--retries', '5', '--socket-timeout', '30',
    '-P', dir, '-o', '%(title).150B [%(id)s].%(ext)s',
    '--progress-template', 'download:PROGRESS|%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s',
    '--print', 'after_move:FILE|%(filepath)s',
    ...(PROXY ? ['--proxy', PROXY] : []),
    `https://www.youtube.com/watch?v=${id}`
  ];
}

export function parseLine(line) {
  const p = /^PROGRESS\|\s*([\d.]+)%\|([^|]*)\|(.*)$/.exec(line);
  if (p) return { percent: Number(p[1]), eta: p[2].trim(), speed: p[3].trim() };
  const f = /^FILE\|(.+)$/.exec(line);
  if (f) return { file: f[1] };
  if (/^\[(Merger|ExtractAudio|VideoRemuxer|Metadata)\]/.test(line)) return { merging: true };
  return null;
}

export function shapeSearchEntry(e) {
  return {
    id: String(e.id ?? ''),
    title: String(e.title ?? ''),
    channel: String(e.channel ?? e.uploader ?? ''),
    durationSeconds: Number(e.duration) || 0,
    views: Number(e.view_count) || 0,
    thumbnail: String((e.thumbnails ?? []).at(-1)?.url ?? `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`)
  };
}

const jobs = new Map();
const queue = [];
let running = 0;

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    if (job.status === 'cancelled') continue;
    running++;
    run(job).finally(() => { running--; pump(); });
  }
}

function run(job) {
  return new Promise(resolve => {
    mkdirSync(job.dir, { recursive: true });
    job.status = 'downloading';
    job.startedAt = new Date().toISOString();
    const child = spawn(BINARY, downloadArgs(job.videoId, job.dir), { stdio: ['ignore', 'pipe', 'pipe'] });
    job.kill = () => child.kill('SIGTERM');
    let stderr = '';
    const onLine = line => {
      const info = parseLine(line.trim());
      if (!info) return;
      if (info.percent !== undefined) Object.assign(job, { percent: info.percent, eta: info.eta, speed: info.speed });
      if (info.file) job.file = info.file;
      if (info.merging) job.status = 'merging';
    };
    let buffer = '';
    child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { onLine(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', err => { job.status = 'error'; job.error = `yt-dlp could not start: ${err.message}`; job.finishedAt = new Date().toISOString(); resolve(); });
    child.on('close', code => {
      if (job.status === 'cancelled') { job.finishedAt = new Date().toISOString(); return resolve(); }
      if (code === 0) { job.status = 'done'; job.percent = 100; }
      else { job.status = 'error'; job.error = (stderr.split('\n').filter(Boolean).at(-1) ?? `yt-dlp stopped (${code})`).replace(/^ERROR:\s*/, '').slice(0, 300); }
      job.finishedAt = new Date().toISOString();
      resolve();
    });
  });
}

function publicJob(job) {
  const { kill: _kill, ...rest } = job;
  return rest;
}

function search(q) {
  return new Promise((resolve, reject) => {
    execFile(BINARY, ['--js-runtimes', 'node', '--flat-playlist', '-J', '--no-warnings', ...(PROXY ? ['--proxy', PROXY] : []), `ytsearch15:${q}`],
      { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
        if (error) return reject(new Error('YouTube could not be searched right now.'));
        try {
          const data = JSON.parse(stdout);
          resolve((data.entries ?? []).filter(e => e && VIDEO_ID.test(String(e.id ?? '')) && e.live_status !== 'is_live' && e.live_status !== 'is_upcoming').map(shapeSearchEntry));
        } catch { reject(new Error('YouTube returned something unreadable.')); }
      });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20_000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('bad json')); } });
  });
}

function authorised(req, token) {
  const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

function start() {
  if (!existsSync(TOKEN_FILE)) { console.error(`No token at ${TOKEN_FILE}; nothing would be allowed to use this service.`); process.exit(1); }
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) { console.error('The token file is empty.'); process.exit(1); }

  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  http.createServer(async (req, res) => {
    try {
      if (!authorised(req, token)) return send(res, 401, { error: 'unauthorised' });
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/jobs') return send(res, 200, { jobs: [...jobs.values()].reverse().map(publicJob) });
      if (req.method === 'POST' && url.pathname === '/search') {
        const { q } = await readBody(req);
        if (typeof q !== 'string' || q.trim().length < 2 || q.length > 200) return send(res, 400, { error: 'Type at least two letters.' });
        try { return send(res, 200, { results: await search(q.trim()) }); } catch (e) { return send(res, 502, { error: e.message }); }
      }
      if (req.method === 'POST' && url.pathname === '/download') {
        const { id, dir, title } = await readBody(req);
        const destination = safeDestination(dir);
        if (!VIDEO_ID.test(String(id ?? ''))) return send(res, 400, { error: 'That is not a YouTube video id.' });
        if (!destination) return send(res, 400, { error: 'That folder is not inside an artist\'s Concerts or Videos folder.' });
        const existing = [...jobs.values()].find(j => j.videoId === id && j.dir === destination && ['queued', 'downloading', 'merging'].includes(j.status));
        if (existing) return send(res, 200, publicJob(existing));
        const job = { id: randomUUID(), videoId: id, title: String(title ?? '').slice(0, 200), dir: destination, status: 'queued', percent: 0, createdAt: new Date().toISOString() };
        jobs.set(job.id, job);
        while (jobs.size > 60) jobs.delete(jobs.keys().next().value);
        queue.push(job);
        pump();
        return send(res, 202, publicJob(job));
      }
      const cancel = /^\/jobs\/([\w-]+)\/cancel$/.exec(url.pathname);
      if (req.method === 'POST' && cancel) {
        const job = jobs.get(cancel[1]);
        if (!job) return send(res, 404, { error: 'not found' });
        if (['queued', 'downloading', 'merging'].includes(job.status)) { job.status = 'cancelled'; job.kill?.(); }
        return send(res, 200, publicJob(job));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e instanceof Error ? e.message : 'bad request' });
    }
  }).listen(PORT, '0.0.0.0', () => console.log(`YouTube worker listening on ${PORT}`));

  // YouTube changes often; the downloader has to keep up. Failure to update is not fatal.
  const update = () => execFile(BINARY, ['-U'], { timeout: 120_000 }, () => undefined);
  update();
  setInterval(update, 24 * 3_600_000).unref();
}

// Start only when run directly, not when a test imports the helpers above.
const entry = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entry && entry === realpathSync(fileURLToPath(import.meta.url))) start();
