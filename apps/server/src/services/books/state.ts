import { all, db, get, run } from '../../db/app-db.js';
import { currentUserId } from '../user-context.js';

// Where each person is in each book: an EPUB CFI, a PDF page, or "track:seconds" for an audiobook.
let ready = false;
function table(): void {
  if (ready) return;
  db().exec(`CREATE TABLE IF NOT EXISTS book_state (
    user_id TEXT NOT NULL, book_id TEXT NOT NULL, position TEXT NOT NULL DEFAULT '', percent REAL NOT NULL DEFAULT 0,
    finished INTEGER NOT NULL DEFAULT 0, opened_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, book_id));`);
  ready = true;
}

export interface BookState { position: string; percent: number; finished: boolean; openedAt: number; updatedAt: number }
interface Row { book_id: string; position: string; percent: number; finished: number; opened_at: number; updated_at: number }
const toState = (r: Row): BookState => ({ position: r.position, percent: r.percent, finished: r.finished === 1, openedAt: r.opened_at, updatedAt: r.updated_at });

export function getBookState(bookId: string): BookState | null {
  table();
  const r = get<Row>('SELECT * FROM book_state WHERE user_id = ? AND book_id = ?', currentUserId(), bookId);
  return r ? toState(r) : null;
}

export function allBookStates(): Map<string, BookState> {
  table();
  return new Map(all<Row>('SELECT * FROM book_state WHERE user_id = ?', currentUserId()).map(r => [r.book_id, toState(r)]));
}

export interface StatePatch { position?: string; percent?: number; finished?: boolean; opened?: boolean }

/** Merge a patch into this person's state. Reaching 98% or more counts as finished unless said otherwise. */
export function saveBookState(bookId: string, patch: StatePatch, now = Date.now()): BookState {
  table();
  const cur = getBookState(bookId);
  const percent = patch.percent !== undefined ? Math.min(100, Math.max(0, patch.percent)) : cur?.percent ?? 0;
  const finished = patch.finished ?? (patch.percent !== undefined ? percent >= 98 || (cur?.finished === true && percent >= 90) : cur?.finished ?? false);
  const next = { position: patch.position ?? cur?.position ?? '', percent, finished, openedAt: patch.opened || patch.position !== undefined || !cur ? now : cur.openedAt };
  run(`INSERT INTO book_state (user_id, book_id, position, percent, finished, opened_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, book_id) DO UPDATE SET position = excluded.position, percent = excluded.percent, finished = excluded.finished, opened_at = excluded.opened_at, updated_at = excluded.updated_at`,
  currentUserId(), bookId, next.position, next.percent, next.finished ? 1 : 0, next.openedAt, now);
  return { ...next, updatedAt: now };
}

export function clearBookState(bookId: string): void {
  table();
  run('DELETE FROM book_state WHERE user_id = ? AND book_id = ?', currentUserId(), bookId);
}
