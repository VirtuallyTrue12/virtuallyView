import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { REPO_ROOT } from '../lib/paths.js';

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

export default async function tvAppRoutes(server: FastifyInstance) {
  registerTvAppRoute(server);
}
