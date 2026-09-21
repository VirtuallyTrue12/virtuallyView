import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';
import { closeDb, db } from '../db/app-db.js';
import { getServerSettings } from './server-settings.js';
import { notify } from './notifications.js';

const run = promisify(execFile);
const KEEP_FILES = ['users.json', 'integrations.json', 'ai-settings.json', 'theme-settings.json', 'app.sqlite'];
const KEEP_DIRS = ['custom-themes'];
const ALLOWED_TOP = new Set([...KEEP_FILES, ...KEEP_DIRS, 'manifest.json']);
const NAME_RE = /^[A-Za-z0-9._-]+\.tar\.gz$/;
const AUTO_KEEP = 7;

export const backupsDir = () => resolve(DATA_DIR, 'backups');

export interface BackupInfo { name: string; size: number; createdAt: string; kind: string }

export function listBackups(): BackupInfo[] {
  if (!existsSync(backupsDir())) return [];
  return readdirSync(backupsDir()).filter(n => NAME_RE.test(n)).map(name => {
    const st = statSync(join(backupsDir(), name));
    return { name, size: st.size, createdAt: st.mtime.toISOString(), kind: /^(auto|pre-restore)/.exec(name)?.[1] ?? 'manual' };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function backupPath(name: string): string | null {
  return NAME_RE.test(name) && existsSync(join(backupsDir(), name)) ? join(backupsDir(), name) : null;
}

export function deleteBackup(name: string): boolean {
  const p = backupPath(name);
  if (!p) return false;
  rmSync(p);
  return true;
}

/** Everything worth keeping, in one .tar.gz. Sessions are left out on purpose: people sign in again after a restore. */
export async function createBackup(kind: 'manual' | 'auto' | 'pre-restore' = 'manual'): Promise<BackupInfo> {
  const work = mkdtempSync(join(tmpdir(), 'vv-backup-'));
  try {
    for (const f of KEEP_FILES) {
      if (f === 'app.sqlite') continue;
      if (existsSync(join(DATA_DIR, f))) cpSync(join(DATA_DIR, f), join(work, f));
    }
    for (const d of KEEP_DIRS) if (existsSync(join(DATA_DIR, d))) cpSync(join(DATA_DIR, d), join(work, d), { recursive: true });
    // VACUUM INTO writes a consistent copy even while the server is using the database.
    db().exec(`VACUUM INTO '${join(work, 'app.sqlite').replace(/'/g, "''")}'`);
    writeFileSync(join(work, 'manifest.json'), JSON.stringify({ app: 'virtuallyview', format: 1, createdAt: new Date().toISOString(), kind }, null, 2));
    mkdirSync(backupsDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const name = `${kind === 'manual' ? 'virtuallyview' : kind}-${stamp}.tar.gz`;
    await run('tar', ['-czf', join(backupsDir(), name), '-C', work, '.']);
    if (kind === 'auto') for (const old of listBackups().filter(b => b.kind === 'auto').slice(AUTO_KEEP)) deleteBackup(old.name);
    const st = statSync(join(backupsDir(), name));
    return { name, size: st.size, createdAt: st.mtime.toISOString(), kind };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Replace the current data with the contents of a backup. The server must be restarted afterwards. */
export async function restoreBackup(archive: string): Promise<void> {
  const listing = (await run('tar', ['-tzf', archive], { maxBuffer: 8 * 1024 * 1024 })).stdout.split('\n').filter(Boolean);
  for (const entry of listing) {
    const clean = entry.replace(/^\.\//, '');
    if (!clean || clean === '.') continue;
    if (clean.startsWith('/') || clean.split('/').includes('..') || !ALLOWED_TOP.has(clean.split('/')[0]!)) {
      throw new Error(`The file contains something a backup should not (${clean.slice(0, 40)}).`);
    }
  }
  const work = mkdtempSync(join(tmpdir(), 'vv-restore-'));
  try {
    await run('tar', ['-xzf', archive, '-C', work, '--no-same-owner']);
    let manifest: { app?: string } = {};
    try { manifest = JSON.parse(readFileSync(join(work, 'manifest.json'), 'utf8')); } catch { /* checked below */ }
    if (manifest.app !== 'virtuallyview') throw new Error('This is not a virtuallyView backup.');
    await createBackup('pre-restore');
    closeDb();
    for (const f of ['app.sqlite-wal', 'app.sqlite-shm']) rmSync(join(DATA_DIR, f), { force: true });
    for (const f of KEEP_FILES) if (existsSync(join(work, f))) cpSync(join(work, f), join(DATA_DIR, f));
    for (const d of KEEP_DIRS) if (existsSync(join(work, d))) { rmSync(join(DATA_DIR, d), { recursive: true, force: true }); cpSync(join(work, d), join(DATA_DIR, d), { recursive: true }); }
    // Old sessions belong to the old accounts.
    rmSync(join(DATA_DIR, 'sessions.json'), { force: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Daily automatic backup, keeping the last few. */
export function startAutoBackup(): void {
  const tick = async () => {
    if (!getServerSettings().autoBackup) return;
    const last = listBackups().find(b => b.kind === 'auto');
    if (last && Date.now() - Date.parse(last.createdAt) < 23 * 3_600_000) return;
    try { await createBackup('auto'); } catch (error) {
      notify({ type: 'backup', role: 'admin', title: 'Automatic backup failed', body: error instanceof Error ? error.message : '' });
    }
  };
  setTimeout(() => void tick(), 60_000).unref();
  setInterval(() => void tick(), 3_600_000).unref();
}
