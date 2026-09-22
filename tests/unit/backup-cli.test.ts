import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir = '';
const root = process.cwd();
type Auth = typeof import('../../apps/server/src/services/auth.js');
type Backup = typeof import('../../apps/server/src/services/backup.js');
type Db = typeof import('../../apps/server/src/db/app-db.js');
let auth: Auth;
let backup: Backup;
let appDb: Db;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vv-bk-'));
  process.env.VV_DATA_DIR = dir;
  auth = await import('../../apps/server/src/services/auth.js');
  backup = await import('../../apps/server/src/services/backup.js');
  appDb = await import('../../apps/server/src/db/app-db.js');
});

afterAll(() => { appDb.closeDb(); rmSync(dir, { recursive: true, force: true }); });

const cli = (...args: string[]) =>
  execFileSync(resolve(root, 'node_modules/.bin/tsx'), [resolve(root, 'apps/server/src/cli.ts'), ...args], { env: { ...process.env, VV_DATA_DIR: dir }, encoding: 'utf8' });

describe('backup and restore', () => {
  it('a restore brings back the accounts and data from the backup and makes a safety copy', async () => {
    expect(auth.createAccount('owner', 'ownerpass').ok).toBe(true);
    appDb.run("INSERT INTO watch_progress (user_id, media_type, media_id, position_seconds, duration_seconds, percent, updated_at) VALUES ('u1','movie','m1',10,100,10,'now')");
    const made = await backup.createBackup('manual');
    expect(made.name).toMatch(/^virtuallyview-.*\.tar\.gz$/);

    expect(auth.createAccount('intruder', 'intruderpass').ok).toBe(true);
    appDb.run("DELETE FROM watch_progress");
    expect(auth.listUsers().map(u => u.username).sort()).toEqual(['intruder', 'owner']);

    await backup.restoreBackup(backup.backupPath(made.name)!);
    expect(auth.listUsers().map(u => u.username)).toEqual(['owner']);
    expect(appDb.all<{ n: number }>('SELECT COUNT(*) AS n FROM watch_progress')[0]!.n).toBe(1);
    expect(backup.listBackups().some(b => b.kind === 'pre-restore')).toBe(true);
  });

  it('refuses archives that are not virtuallyView backups or try to escape the folder', async () => {
    const bad = join(dir, 'bad.tar.gz');
    writeFileSync(bad, Buffer.alloc(300, 1));
    await expect(backup.restoreBackup(bad)).rejects.toThrow();
    const escape = join(dir, 'escape.tar.gz');
    // An entry named ../users.json. -P keeps the leading ../ and works with GNU and BSD (macOS) tar alike.
    mkdirSync(join(dir, 'inner'), { recursive: true });
    execFileSync('tar', ['-czPf', escape, '-C', join(dir, 'inner'), '../users.json']);
    await expect(backup.restoreBackup(escape)).rejects.toThrow(/should not|not a virtuallyView/i);
  });
});

describe('admin command line', () => {
  it('lists accounts, resets a password and promotes a user', () => {
    expect(cli('users')).toMatch(/owner/);
    const out = cli('reset-password', 'owner', 'freshpass');
    expect(out).toMatch(/freshpass/);
    expect(auth.authenticate('owner', 'freshpass')).toBeTruthy();
    expect(auth.authenticate('owner', 'ownerpass')).toBeNull();
    expect(auth.createAccount('helper', 'helperpass').ok).toBe(true);
    expect(cli('make-admin', 'helper')).toMatch(/administrator/);
    expect(auth.listUsers().find(u => u.username === 'helper')!.role).toBe('admin');
  });

  it('explains a missing account instead of crashing', () => {
    expect(() => cli('reset-password', 'ghost')).toThrow();
  });
});
