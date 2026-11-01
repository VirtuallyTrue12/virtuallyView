import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { REPO_ROOT } from '../lib/paths.js';
import { currentActor } from '../services/user-context.js';

/** Where the Android TV app build lands (apps/android-tv/build.sh). Missing until someone builds it. */
export const TV_APK_FILE = resolve(REPO_ROOT, 'apps/android-tv/dist/virtuallyview-tv.apk');

/**
 * Public download of the Android TV app, so a TV's browser can fetch it. Only the built file is served;
 * when it has not been built, the answer is a short plain-text note instead of an error page.
 */
export function registerTvAppRoute(server: FastifyInstance, file: string = TV_APK_FILE) {
  server.get('/download/virtuallyview-tv.apk', async (_request, reply) => {
    if (!existsSync(file) || !statSync(file).isFile()) {
      return reply.code(404).type('text/plain; charset=utf-8').send('The TV app has not been built on this server yet. See docs/android-tv.md for how to build it.');
    }
    return reply
      .type('application/vnd.android.package-archive')
      .header('Content-Disposition', 'attachment; filename="virtuallyview-tv.apk"')
      .header('Cache-Control', 'no-cache')
      .send(createReadStream(file));
  });
}

/** What a TV last reported about itself (browser, sizes, layout, errors), newest first. Kept in memory only. */
const reports: Array<Record<string, unknown>> = [];
const MAX_REPORTS = 40;

/** Keeps one report: plain values only, every string and list cut short, so a TV cannot fill the server's memory. */
export function cleanReport(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 40)) {
    if (!/^[a-zA-Z][\w]{0,40}$/.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 600);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.slice(0, 30).map(v => (typeof v === 'string' ? v.slice(0, 300) : typeof v === 'number' || typeof v === 'boolean' ? v : null));
  }
  return out;
}

export default async function tvAppRoutes(server: FastifyInstance) {
  registerTvAppRoute(server);

  // TVs send a short report of how the page looks on them, so problems can be seen without plugging a cable in.
  server.post<{ Body: unknown }>('/api/tv-report', async (request, reply) => {
    const report = cleanReport(request.body);
    if (!report) return reply.code(400).send({ message: 'Send a report object.' });
    reports.unshift({ ...report, at: new Date().toISOString() });
    // Also in the server log, so a report can be read on the server computer without signing in.
    request.log.info({ tvReport: report }, 'tv report');
    reports.length = Math.min(reports.length, MAX_REPORTS);
    return { ok: true };
  });

  server.get('/api/tv-report', async (_request, reply) => {
    if (currentActor().role === 'user') return reply.code(403).send({ message: 'Only an administrator can read TV reports.' });
    return { reports };
  });
}
