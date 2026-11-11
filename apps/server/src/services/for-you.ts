import type { Media } from '@virtuallyview/types';
import { all } from '../db/app-db.js';
import { currentUserId } from './user-context.js';
import { pickAnchors, similarTitles, type AnchorEvent, type TasteSignals } from './home-rails.js';
import { mixForYou, type ForYouItem } from './for-you-mix.js';
import { videoHistory, subscriptionFeed } from './invidious.js';
import { subscriptions } from './video-lists.js';

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; items: ForYouItem[] }>();

interface Inputs {
  /** Movies and shows in the library, already filtered by this viewer's age limit. */
  titles: Media[];
  artists: Media[];
  anchorEvents: AnchorEvent[];
  signals: TasteSignals;
  kid: boolean;
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);

/** The "For you" rail for this profile, cached for a few minutes. Empty when there is no history. */
export async function forYouRail(input: Inputs): Promise<Array<{ id: string; title: string; kind: 'foryou'; items: ForYouItem[] }>> {
  const user = currentUserId();
  const hit = cache.get(user);
  const items = hit && Date.now() - hit.at < TTL_MS ? hit.items : await build(input);
  cache.set(user, { at: Date.now(), items });
  return items.length ? [{ id: 'for-you', title: 'For you', kind: 'foryou', items }] : [];
}

async function build({ titles, artists, anchorEvents, signals, kid }: Inputs): Promise<ForYouItem[]> {
  const byId = new Map(titles.map(t => [t.id, t]));
  const playable = titles.filter(t => t.status === 'available');

  // Movies and shows: titles like the ones this profile watched or finished lately.
  const watched: ForYouItem[] = [];
  for (const anchorId of pickAnchors(anchorEvents, signals.thumbsDown, new Set(byId.keys()), 4)) {
    const anchor = byId.get(anchorId)!;
    for (const { item } of similarTitles(anchor, playable, signals, 6)) {
      watched.push({ ...item, kind: item.type === 'series' ? 'series' : 'movie', reason: `Because you watched ${anchor.title}` });
    }
  }
  const groups = {
    movie: watched.filter(i => i.kind === 'movie'),
    series: watched.filter(i => i.kind === 'series'),
    artist: [] as ForYouItem[],
    video: [] as ForYouItem[]
  };
  if (kid) return mixForYou(groups, { kid });

  // Music: the artists this profile played most in the last 90 days that are in the library.
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const plays = all<{ artistId: string | null; artist: string }>(
    `SELECT artist_id AS artistId, artist FROM music_plays WHERE user_id = ? AND played_at >= ?
     GROUP BY COALESCE(artist_id, artist) ORDER BY COUNT(*) DESC LIMIT 10`, currentUserId(), since);
  for (const play of plays) {
    const artist = artists.find(a => a.id === play.artistId) ?? artists.find(a => a.title.toLowerCase() === play.artist.toLowerCase());
    if (artist) groups.artist.push({ ...artist, kind: 'artist', reason: `More from ${artist.title}` });
  }

  // Videos: new uploads from channels this profile follows or has watched, minus what it already watched.
  try {
    const history = videoHistory();
    const channels = new Set(subscriptions().map(c => c.id));
    for (const v of history) if (v.channelId) channels.add(v.channelId);
    if (channels.size) {
      const seen = new Set(history.map(v => v.id));
      const feed = await withTimeout(subscriptionFeed([...channels].slice(0, 8)), 2500, { videos: [], failed: 0 });
      for (const v of feed.videos) {
        if (seen.has(v.id)) continue;
        groups.video.push({
          id: v.id, kind: 'video', title: v.title, type: 'video', artwork: { poster: v.thumbnail },
          href: `/videos/watch/${v.id}`, reason: `New from ${v.channel}`
        });
      }
    }
  } catch { /* videos are optional: the rail still shows the rest */ }

  return mixForYou(groups, { kid });
}
