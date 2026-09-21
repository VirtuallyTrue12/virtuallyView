import { createReadStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { backupPath, createBackup, deleteBackup, listBackups, restoreBackup } from '../services/backup.js';
import { notify } from '../services/notifications.js';
import { currentActor } from '../services/user-context.js';

const denied = (reply: FastifyReply) => reply.code(403).send({ message: 'Only an administrator can do that.' });

export default async function backupRoutes(server: FastifyInstance) {
  for (const type of ['application/gzip', 'application/x-gzip', 'application/octet-stream']) {
    server.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: 1024 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  }

  server.get('/api/backup', async (_request, reply) => (currentActor().role === 'user' ? denied(reply) : { backups: listBackups() }));

  server.post('/api/backup', async (_request, reply) => {
    if (currentActor().role === 'user') return denied(reply);
    try {
      const backup = await createBackup('manual');
      notify({ type: 'backup', role: 'admin', title: 'Backup created', body: backup.name });
      return { backup, backups: listBackups() };
    } catch (error) {
      return reply.code(500).send({ message: error instanceof Error ? error.message : 'The backup could not be created.' });
    }
  });

  server.get<{ Params: { name: string } }>('/api/backup/:name', async (request, reply) => {
    if (currentActor().role === 'user') return denied(reply);
    const file = backupPath(request.params.name);
    if (!file) return reply.code(404).send({ message: 'No such backup.' });
    return reply
      .header('Content-Type', 'application/gzip')
      .header('Content-Disposition', `attachment; filename="${request.params.name}"`)
      .send(createReadStream(file));
  });

  server.delete<{ Params: { name: string } }>('/api/backup/:name', async (request, reply) => {
    if (currentActor().role === 'user') return denied(reply);
    return deleteBackup(request.params.name) ? { backups: listBackups() } : reply.code(404).send({ message: 'No such backup.' });
  });

  const finish = (reply: FastifyReply) => {
    // A restore swaps files under a running server; a clean restart (Docker restarts it) picks everything up.
    if (process.env.VV_NO_RESTART !== '1') setTimeout(() => process.exit(0), 800).unref();
    return reply.send({ ok: true, restarting: process.env.VV_NO_RESTART !== '1', message: 'Restored. The server is restarting; reload in a few seconds and sign in again.' });
  };

  server.post<{ Params: { name: string } }>('/api/backup/:name/restore', async (request, reply) => {
    if (currentActor().role === 'user') return denied(reply);
    const file = backupPath(request.params.name);
    if (!file) return reply.code(404).send({ message: 'No such backup.' });
    try { await restoreBackup(file); } catch (error) { return reply.code(422).send({ message: error instanceof Error ? error.message : 'The restore failed.' }); }
    return finish(reply);
  });

  server.post('/api/backup/restore', { bodyLimit: 1024 * 1024 * 1024 }, async (request, reply) => {
    if (currentActor().role === 'user') return denied(reply);
    const body = request.body as Buffer | undefined;
    if (!Buffer.isBuffer(body) || body.length < 100) return reply.code(400).send({ message: 'Choose a backup file to restore.' });
    const dir = mkdtempSync(join(tmpdir(), 'vv-upload-'));
    try {
      const file = join(dir, 'upload.tar.gz');
      writeFileSync(file, body);
      await restoreBackup(file);
    } catch (error) {
      return reply.code(422).send({ message: error instanceof Error ? error.message : 'The restore failed.' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return finish(reply);
  });
}
