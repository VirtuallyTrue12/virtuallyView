import { all, run } from '../db/app-db.js';
import { currentUserId } from './user-context.js';
import { listFlagged, setFlags } from './user-flags.js';
import { channelById } from './live-tv.js';
import { outboundFetch } from './outbound.js';

export const favoriteChannels = (): string[] => listFlagged('favorite').filter(f => f.mediaType === 'channel').map(f => f.mediaId);
export const setChannelFavorite = (id: string, favorite: boolean): void => { setFlags('channel', id, { favorite }); };

export function touchRecent(id: string, name: string): void {
  const user = currentUserId();
  run('INSERT INTO live_recent (user_id, channel_id, name, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET at = excluded.at, name = excluded.name', user, id, name.slice(0, 120), new Date().toISOString());
  run('DELETE FROM live_recent WHERE user_id = ? AND channel_id NOT IN (SELECT channel_id FROM live_recent WHERE user_id = ? ORDER BY at DESC LIMIT 30)', user, user);
}
export const recentChannels = (): string[] => all<{ channel_id: string }>('SELECT channel_id FROM live_recent WHERE user_id = ? ORDER BY at DESC LIMIT 20', currentUserId()).map(r => r.channel_id);

/** Channels that failed their last check, unless a later check found them alive. */
export const deadChannels = (): string[] => all<{ channel_id: string }>('SELECT channel_id FROM live_health WHERE ok = 0').map(r => r.channel_id);

async function alive(url: string): Promise<boolean> {
  try {
    const res = await outboundFetch(url, { timeoutMs: 7000, headers: { Range: 'bytes=0-1023' } });
    void res.body?.cancel();
    return res.status === 200 || res.status === 206;
  } catch { return false; }
}

/** Check up to a batch of channels, a few at a time, and remember the answers. */
export async function checkChannels(ids: string[]): Promise<{ checked: number; dead: string[]; alive: string[] }> {
  const dead: string[] = [], good: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++]!;
      const channel = await channelById(id);
      if (!channel) continue;
      const ok = await alive(channel.url);
      (ok ? good : dead).push(id);
      run('INSERT INTO live_health (channel_id, ok, checked_at) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET ok = excluded.ok, checked_at = excluded.checked_at', id, ok ? 1 : 0, new Date().toISOString());
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { checked: dead.length + good.length, dead, alive: good };
}
