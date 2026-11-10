import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db/app-db.js';
import { currentUserId } from './user-context.js';
import type { ChannelResult, VideoResult } from './invidious.js';

/**
 * The Videos section's per-person lists, kept only in this server's database: channels followed, Watch later,
 * Saved (downloaded into the videos library), and where each video was left. Nothing here is sent anywhere.
 */

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export type VideoList = 'later' | 'saved';

const parse = <T>(rows: Array<{ snapshot: string }>): T[] => rows.flatMap(r => { try { return [JSON.parse(r.snapshot) as T]; } catch { return []; } });
const now = () => new Date().toISOString();

export const subscriptions = (): ChannelResult[] =>
  parse<ChannelResult>(all('SELECT snapshot FROM video_subscriptions WHERE user_id = ? ORDER BY at DESC LIMIT 500', currentUserId()));

export function subscribe(channel: ChannelResult): void {
  run('INSERT INTO video_subscriptions (user_id, channel_id, snapshot, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET snapshot = excluded.snapshot',
    currentUserId(), channel.id, JSON.stringify(channel), now());
}

export function unsubscribe(channelId: string): void {
  run('DELETE FROM video_subscriptions WHERE user_id = ? AND channel_id = ?', currentUserId(), channelId);
}

export const isSubscribed = (channelId: string): boolean =>
  !!get('SELECT 1 FROM video_subscriptions WHERE user_id = ? AND channel_id = ?', currentUserId(), channelId);

export const listVideos = (list: VideoList): VideoResult[] =>
  parse<VideoResult>(all('SELECT snapshot FROM video_lists WHERE user_id = ? AND list = ? ORDER BY at DESC LIMIT 500', currentUserId(), list));

export function addToList(list: VideoList, video: VideoResult): void {
  run('INSERT INTO video_lists (user_id, list, video_id, snapshot, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, list, video_id) DO UPDATE SET snapshot = excluded.snapshot, at = excluded.at',
    currentUserId(), list, video.id, JSON.stringify(video), now());
}

export function removeFromList(list: VideoList, id: string): void {
  run('DELETE FROM video_lists WHERE user_id = ? AND list = ? AND video_id = ?', currentUserId(), list, id);
}

export const inList = (list: VideoList, id: string): boolean =>
  !!get('SELECT 1 FROM video_lists WHERE user_id = ? AND list = ? AND video_id = ?', currentUserId(), list, id);

/** Anyone at all still has this video saved: its file must stay. */
export const savedByAnyone = (id: string): boolean => !!get("SELECT 1 FROM video_lists WHERE list = 'saved' AND video_id = ?", id);

/** A snapshot of this video from any of this person's lists, for when the video service cannot be asked. */
export function knownVideo(id: string): VideoResult | null {
  const row = get<{ snapshot: string }>('SELECT snapshot FROM video_lists WHERE user_id = ? AND video_id = ? UNION ALL SELECT snapshot FROM video_history WHERE user_id = ? AND video_id = ? LIMIT 1',
    currentUserId(), id, currentUserId(), id);
  return row ? parse<VideoResult>([row])[0] ?? null : null;
}

export type ProgressVideo = VideoResult & { position: number; duration: number };

/** Remember where a video was left. A video played from Saved while the video service is off has no history
 * row yet, so one is made from the saved copy's details. */
export function saveProgress(id: string, position: number, duration: number): boolean {
  const user = currentUserId();
  const changed = run('UPDATE video_history SET position = ?, duration = ?, at = ? WHERE user_id = ? AND video_id = ?', position, duration, now(), user, id);
  if (Number(changed.changes)) return true;
  const known = knownVideo(id);
  if (!known) return false;
  run('INSERT INTO video_history (user_id, video_id, snapshot, at, position, duration) VALUES (?, ?, ?, ?, ?, ?)', user, id, JSON.stringify(known), now(), position, duration);
  return true;
}

export const progressOf = (id: string): number =>
  get<{ position: number }>('SELECT position FROM video_history WHERE user_id = ? AND video_id = ?', currentUserId(), id)?.position ?? 0;

/** Started and not finished: more than half a minute in, and more than half a minute left. */
export const continueWatching = (): ProgressVideo[] =>
  all<{ snapshot: string; position: number; duration: number }>(
    'SELECT snapshot, position, duration FROM video_history WHERE user_id = ? AND position >= 30 AND duration > 0 AND position < duration - 30 ORDER BY at DESC LIMIT 20', currentUserId()
  ).flatMap(r => parse<VideoResult>([r]).map(v => ({ ...v, position: r.position, duration: r.duration })));

// ---- The videos library: one file per saved video, named by its id, written by the YouTube worker ----

export const videosLibrary = (): string => path.resolve(process.env.VIDEOS_LIBRARY ?? '/media/videos');

/** The finished file for a saved video, or null. Half-done downloads (.part, per-stream .f137.mp4) never count. */
export function savedFile(id: string): string | null {
  if (!VIDEO_ID.test(id)) return null;
  try {
    const name = readdirSync(videosLibrary()).find(f => f.startsWith(`${id}.`) && /^(mp4|m4v|mkv|webm|mov)$/i.test(f.slice(id.length + 1)));
    return name ? path.join(videosLibrary(), name) : null;
  } catch { return null; }
}

export const savedSize = (file: string): number => { try { return statSync(file).size; } catch { return 0; } };

/** Removes the saved file once nobody has the video saved any more. */
export function removeSavedFileIfUnused(id: string): boolean {
  if (savedByAnyone(id)) return false;
  const file = savedFile(id);
  if (!file) return false;
  try { unlinkSync(file); return true; } catch { return false; }
}
