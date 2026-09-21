import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR } from '../lib/paths.js';

/**
 * Single shared SQLite handle for server-owned state: watch progress, the
 * request ledger, server settings, cast cache, and artist cover choices.
 * Everything here lives server-side so every device sees the same data.
 *
 * Uses Node's built-in `node:sqlite` (DatabaseSync) so there is no native
 * addon to compile in container images or on odd filesystem paths.
 */
let _db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (_db) return _db;
  // Tests inject a throwaway directory so the ledger, caches and settings
  // never bleed between suites or into a live data dir.
  const dataDir = process.env.VV_DATA_DIR
    ? resolve(process.env.VV_DATA_DIR)
    : DATA_DIR;
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, 'app.sqlite'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS watch_progress (
      user_id TEXT NOT NULL DEFAULT 'shared',
      media_type TEXT NOT NULL,
      media_id TEXT NOT NULL,
      position_seconds REAL NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      percent REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, media_type, media_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audience_user TEXT,
      audience_role TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_reads (
      user_id TEXT NOT NULL,
      notification_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, notification_id)
    );

    CREATE TABLE IF NOT EXISTS user_flags (
      user_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      media_id TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      watched INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, media_type, media_id)
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS server_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cast_cache (
      media_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artist_covers (
      artist_id TEXT PRIMARY KEY,
      covers TEXT NOT NULL,
      chosen TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS web_cover_cache (
      query TEXT PRIMARY KEY,
      cover TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tracks TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS series_last (
      user_id TEXT NOT NULL,
      series_id TEXT NOT NULL,
      episode_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, series_id)
    );
  `);
  // Older databases kept one shared progress table; move it to per-user rows
  // (existing rows become 'shared' and stay visible until a user has their own).
  const cols = db.prepare('PRAGMA table_info(watch_progress)').all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === 'user_id')) {
    db.exec(`
      ALTER TABLE watch_progress RENAME TO watch_progress_legacy;
      CREATE TABLE watch_progress (
        user_id TEXT NOT NULL DEFAULT 'shared',
        media_type TEXT NOT NULL,
        media_id TEXT NOT NULL,
        position_seconds REAL NOT NULL DEFAULT 0,
        duration_seconds REAL NOT NULL DEFAULT 0,
        percent REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, media_type, media_id)
      );
      INSERT INTO watch_progress (user_id, media_type, media_id, position_seconds, duration_seconds, percent, updated_at)
        SELECT 'shared', media_type, media_id, position_seconds, duration_seconds, percent, updated_at FROM watch_progress_legacy;
      DROP TABLE watch_progress_legacy;
    `);
  }
  if (!(db.prepare('PRAGMA table_info(watch_progress)').all() as Array<{ name: string }>).some(c => c.name === 'context')) {
    db.exec('ALTER TABLE watch_progress ADD COLUMN context TEXT');
  }
  _db = db;
  return db;
}

/** Close the shared handle (used before restoring a backup over the database file). */
export function closeDb(): void {
  if (_db) { try { _db.close(); } catch { /* already closed */ } _db = null; }
}

export function db(): DatabaseSync {
  return open();
}

export function get<T = unknown>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return open().prepare(sql).get(...params) as T | undefined;
}

export function all<T = unknown>(sql: string, ...params: SQLInputValue[]): T[] {
  return open().prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
  return open().prepare(sql).run(...params);
}

/**
 * Sequential transaction wrapper. node:sqlite manages a single connection, so
 * a BEGIN/COMMIT pair with rollback on error mirrors the better-sqlite3
 * transaction helper without needing a native addon.
 */
export function transaction<T>(fn: () => T): T {
  const connection = open();
  connection.exec('BEGIN;');
  try {
    const result = fn();
    connection.exec('COMMIT;');
    return result;
  } catch (error) {
    try { connection.exec('ROLLBACK;'); } catch { /* connection may be gone */ }
    throw error;
  }
}