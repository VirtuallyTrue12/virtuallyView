import { all, run, transaction } from '../db/app-db.js';
import { currentUserId } from './user-context.js';
import type { LayoutRow } from './home-rails.js';

/** This viewer's saved home rails: order and hidden flags. Empty means the default layout. */
export function savedHomeLayout(): LayoutRow[] {
  return all<{ rail_id: string; hidden: number; position: number }>(
    'SELECT rail_id, hidden, position FROM home_layout WHERE user_id = ? ORDER BY position',
    currentUserId()
  ).map(r => ({ railId: r.rail_id, hidden: r.hidden === 1, position: r.position }));
}

/** Replace this viewer's layout. An empty list resets it to the default. */
export function saveHomeLayout(rows: LayoutRow[]): void {
  const userId = currentUserId();
  transaction(() => {
    run('DELETE FROM home_layout WHERE user_id = ?', userId);
    for (const row of rows) {
      run(
        'INSERT INTO home_layout (user_id, rail_id, hidden, position) VALUES (?, ?, ?, ?)',
        userId, row.railId, row.hidden ? 1 : 0, row.position
      );
    }
  });
}
