import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { REPO_ROOT } from '../lib/paths.js';
import { loadServiceConfig } from '../services/registry.js';

const SCRIPT = resolve(REPO_ROOT, 'scripts/provision-stack.mjs');
const TIMEOUT_MS = 4 * 60 * 1000;
let running: Promise<{ ok: boolean; partial: boolean; log: string[] }> | null = null;

/**
 * The address and key for each service, as this server knows them: what was
 * saved under Settings > Services first, then the environment. The setup
 * script uses the same variable names as the bundled Docker stack.
 */
function setupEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const saved = loadServiceConfig();
  const pairs: Array<[string, string]> = [['radarr', 'RADARR'], ['sonarr', 'SONARR'], ['lidarr', 'LIDARR'], ['prowlarr', 'PROWLARR'], ['bazarr', 'BAZARR']];
  for (const [key, prefix] of pairs) {
    const entry = saved[key];
    if (entry?.url && entry.apiKey) {
      env[`${prefix}_URL`] = entry.url.replace(/\/+$/, '');
      env[`${prefix}_API_KEY`] = entry.apiKey;
    }
  }
  const qbit = saved.qbittorrent;
  const qbitUrl = qbit?.url ?? process.env.QBITTORRENT_URL;
  if (qbitUrl) {
    try {
      const parsed = new URL(qbitUrl);
      env.QBITTORRENT_HOST = parsed.hostname;
      env.QBITTORRENT_PORT = parsed.port || '8080';
    } catch { /* keep the defaults */ }
  }
  if (qbit?.apiKey?.includes(':')) {
    const at = qbit.apiKey.indexOf(':');
    env.QBITTORRENT_USERNAME = qbit.apiKey.slice(0, at);
    env.QBITTORRENT_PASSWORD = qbit.apiKey.slice(at + 1);
  }
  return env;
}

function runSetup(): Promise<{ ok: boolean; partial: boolean; log: string[] }> {
  return new Promise(done => {
    const lines: string[] = [];
    const child = spawn(process.execPath, [SCRIPT], { env: setupEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const take = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const text = line.replace(/^\[provision\]\s*/, '').trim();
        if (text) lines.push(text);
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => { child.kill('SIGKILL'); lines.push('Setup took too long and was stopped. Check that the services are running, then try again.'); }, TIMEOUT_MS);
    child.on('close', code => {
      clearTimeout(timer);
      done({ ok: code === 0, partial: code === 3, log: lines.slice(-60) });
    });
    child.on('error', err => {
      clearTimeout(timer);
      done({ ok: false, partial: false, log: [`Could not start the setup: ${err.message}`] });
    });
  });
}

/**
 * "Set it up for me": run the same setup the Docker stack runs on first start
 * (folders, download clients, a search source, the links between services and
 * subtitles). Everything it does is safe to repeat: finished steps are skipped.
 */
export default async function setupRoutes(server: FastifyInstance) {
  server.post('/api/setup/repair', async (_request, reply) => {
    if (!existsSync(SCRIPT)) return reply.code(501).send({ ok: false, log: ['The setup script is not part of this installation.'] });
    running ??= runSetup().finally(() => { running = null; });
    return running;
  });
}
