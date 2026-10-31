import { describe, expect, it, afterAll } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTvAppRoute } from '../../apps/server/src/routes/tv-app';

const dir = mkdtempSync(join(tmpdir(), 'vv-tv-app-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('GET /download/virtuallyview-tv.apk', () => {
  it('serves the built APK with the Android package content type', async () => {
    const file = join(dir, 'virtuallyview-tv.apk');
    const bytes = Buffer.from('PK\u0003\u0004fake-apk-bytes');
    writeFileSync(file, bytes);
    const server = Fastify();
    registerTvAppRoute(server, file);
    const res = await server.inject({ method: 'GET', url: '/download/virtuallyview-tv.apk' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(res.headers['content-disposition']).toContain('virtuallyview-tv.apk');
    expect(res.rawPayload.equals(bytes)).toBe(true);
    await server.close();
  });

  it('answers 404 with a plain message when the APK has not been built', async () => {
    const server = Fastify();
    registerTvAppRoute(server, join(dir, 'missing.apk'));
    const res = await server.inject({ method: 'GET', url: '/download/virtuallyview-tv.apk' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('has not been built');
    await server.close();
  });
});
