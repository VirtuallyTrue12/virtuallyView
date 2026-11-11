import { all, run } from '../db/app-db.js';
import { currentUserId } from './user-context.js';
import { listFlagged, setFlags } from './user-flags.js';
import { channelById, type Channel } from './live-tv.js';
import { checkNow, deadIds } from './live-probe.js';

export const favoriteChannels = (): string[] => listFlagged('favorite').filter(f => f.mediaType === 'channel').map(f => f.mediaId);
export const setChannelFavorite = (id: string, favorite: boolean): void => { setFlags('channel', id, { favorite }); };

export function touchRecent(id: string, name: string): void {
  const user = currentUserId();
  run('INSERT INTO live_recent (user_id, channel_id, name, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET at = excluded.at, name = excluded.name', user, id, name.slice(0, 120), new Date().toISOString());
  run('DELETE FROM live_recent WHERE user_id = ? AND channel_id NOT IN (SELECT channel_id FROM live_recent WHERE user_id = ? ORDER BY at DESC LIMIT 30)', user, user);
}
export const recentChannels = (): string[] => all<{ channel_id: string }>('SELECT channel_id FROM live_recent WHERE user_id = ? ORDER BY at DESC LIMIT 20', currentUserId()).map(r => r.channel_id);

/** Channels that failed two checks in a row, unless a later check found them alive. */
export const deadChannels = (): string[] => deadIds();

/** Test a batch of channels now and remember the answers. */
export async function checkChannels(ids: string[]): Promise<{ checked: number; dead: string[]; alive: string[] }> {
  const found = (await Promise.all(ids.map(channelById))).filter((c): c is Channel => !!c);
  const r = await checkNow(found);
  return { checked: r.dead.length + r.alive.length, ...r };
}
