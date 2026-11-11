import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LidarrAdapter, LidarrImport, SonarrAdapter, SonarrImport } from '@virtuallyview/integrations';
import { all, get, run } from '../db/app-db.js';
import { DATA_DIR } from '../lib/paths.js';
import { getAdapter } from './registry.js';
import { getRequests } from './requests.js';
import { detectSeries } from './segments.js';
import { notify } from './notifications.js';
import { listUsers } from './auth.js';

/**
 * New arrivals: tells people when a show they watch gets a new episode, or an artist they follow gets a new
 * album. Sonarr and Lidarr keep a history of every import; a check every 10 minutes reads what came in since
 * the last check. Imports caused by a request are skipped, because the request already says it is ready.
 */

const CHECK_EVERY_MS = 10 * 60_000;
/** A check that keeps failing never reads further back than this, so a long outage does not flood people with old news. */
const MAX_LOOKBACK_MS = 2 * 86_400_000;
const WATCHED_WINDOW_MS = 90 * 86_400_000;
/** An import this close to a request's last update is taken to be the request's own download. */
const REQUEST_WINDOW_MS = 2 * 3_600_000;
const IN_FLIGHT = new Set(['pending', 'searching', 'downloading', 'importing']);

// ---------------------------------------------------------------- who follows what

export interface FollowInputs {
  users: Array<{ userId: string; role: string }>;
  /** My List rows. */
  favorites: Array<{ userId: string; mediaId: string }>;
  /** Shows a viewer touched recently (episode progress, or the last episode they played in a show). */
  recentShows: Array<{ userId: string; seriesId: string }>;
  /** Artist ids in the library. Administrators follow all of them. */
  libraryArtistIds: string[];
}

export interface Follows { series: Set<string>; artists: Set<string> }

/**
 * Which shows and artists each viewer follows.
 * A show: it is in My List, or they touched one of its episodes in the last 90 days.
 * An artist: it is in My List, or it is in the library and they are an administrator.
 * (There is no music play history yet, so playing an artist does not count.)
 */
export function followsByUser(input: FollowInputs): Map<string, Follows> {
  const out = new Map<string, Follows>();
  const slot = (userId: string): Follows => {
    let f = out.get(userId);
    if (!f) { f = { series: new Set(), artists: new Set() }; out.set(userId, f); }
    return f;
  };
  for (const u of input.users) {
    const f = slot(u.userId);
    if (u.role === 'admin') for (const id of input.libraryArtistIds) f.artists.add(id);
  }
  for (const { userId, mediaId } of input.favorites) {
    if (mediaId.startsWith('sonarr-')) slot(userId).series.add(mediaId);
    else if (mediaId.startsWith('lidarr-')) slot(userId).artists.add(mediaId);
  }
  for (const { userId, seriesId } of input.recentShows) {
    if (seriesId.startsWith('sonarr-')) slot(userId).series.add(seriesId);
  }
  return out;
}

/** Reads the follow signals from the database. Only the listed users are included. */
export function loadFollowInputs(users: Array<{ userId: string; role: string }>, libraryArtistIds: string[]): FollowInputs {
  const ids = new Set(users.map(u => u.userId));
  const since = new Date(Date.now() - WATCHED_WINDOW_MS).toISOString();
  return {
    users,
    libraryArtistIds,
    favorites: all<{ userId: string; mediaId: string }>(
      'SELECT user_id AS userId, media_id AS mediaId FROM user_flags WHERE favorite = 1'
    ).filter(r => ids.has(r.userId)),
    recentShows: all<{ userId: string; seriesId: string }>(
      `SELECT user_id AS userId, context AS seriesId FROM watch_progress WHERE media_type = 'episode' AND context IS NOT NULL AND updated_at >= ?
       UNION
       SELECT user_id AS userId, series_id AS seriesId FROM series_last WHERE updated_at >= ?`,
      since, since
    ).filter(r => ids.has(r.userId))
  };
}

// ---------------------------------------------------------------- requests and first runs

export interface RequestLike { providerId?: string; status: string; updatedAt: string }

/** True when an import of `mediaId` at `at` is most likely the download of a request (which already notifies). */
export function isRequestDriven(mediaId: string, at: string, requests: RequestLike[]): boolean {
  const t = Date.parse(at);
  return requests.some(r =>
    r.providerId === mediaId && r.status !== 'cancelled' &&
    (IN_FLIGHT.has(r.status) || Math.abs(Date.parse(r.updatedAt) - t) <= REQUEST_WINDOW_MS)
  );
}

// ---------------------------------------------------------------- grouping into notices

export interface Notice {
  type: 'library.new-episode' | 'library.new-release';
  /** Show id for an episode, artist id for an album: a follower of this id hears about it. */
  mediaId: string;
  title: string;
  body: string;
  link: string;
  /** When it arrived (ISO). */
  at: string;
  /** What the home rail says, e.g. "S02E05" or "3 new episodes". */
  detail: string;
  /** Unique per arrival, so one arrival is never recorded or announced twice. */
  key: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const episodeCode = (season: number, episode: number) => `S${pad(season)}E${pad(episode)}`;

/** One notice per show per check, however many episodes came in. */
export function episodeNotices(imports: SonarrImport[]): Notice[] {
  const byShow = new Map<string, SonarrImport[]>();
  for (const i of imports) byShow.set(i.seriesId, [...(byShow.get(i.seriesId) ?? []), i]);
  const notices: Notice[] = [];
  for (const [seriesId, list] of byShow) {
    // Two copies of the same episode count once.
    const episodes = new Map<string, { code: string; season: number; episode: number }>();
    for (const i of list) {
      const code = episodeCode(i.season, i.episode);
      episodes.set(code, { code, season: i.season, episode: i.episode });
    }
    const sorted = [...episodes.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
    const show = list[0].seriesTitle;
    const latest = list.reduce((m, i) => (Date.parse(i.at) > Date.parse(m) ? i.at : m), list[0].at);
    const many = sorted.length > 1;
    notices.push({
      type: 'library.new-episode',
      mediaId: seriesId,
      title: many ? `${sorted.length} new episodes of ${show}` : `New episode: ${show} ${sorted[0].code}`,
      body: many ? sorted.map(e => e.code).join(', ') : '',
      link: `/series/${seriesId}`,
      at: latest,
      detail: many ? `${sorted.length} new episodes` : sorted[0].code,
      key: `episode:${seriesId}:${latest}`
    });
  }
  return notices;
}

/** One notice per album. */
export function albumNotices(imports: LidarrImport[]): Notice[] {
  const byAlbum = new Map<number, LidarrImport[]>();
  for (const i of imports) byAlbum.set(i.albumId, [...(byAlbum.get(i.albumId) ?? []), i]);
  return [...byAlbum.values()].map(list => {
    const first = list[0];
    const latest = list.reduce((m, i) => (Date.parse(i.at) > Date.parse(m) ? i.at : m), first.at);
    return {
      type: 'library.new-release' as const,
      mediaId: first.artistId,
      title: `New album: ${first.artistName} – ${first.albumTitle}`,
      body: '',
      link: `/albums/${first.albumId}`,
      at: latest,
      detail: first.albumTitle,
      key: `album:${first.albumId}`
    };
  });
}

// ---------------------------------------------------------------- one check

export type Cursors = { sonarr?: string; lidarr?: string };

export interface CheckInput {
  now: string;
  cursors: Cursors;
  sonarr?: Pick<SonarrAdapter, 'getRecentImports'>;
  lidarr?: Pick<LidarrAdapter, 'getRecentImports'>;
  requests: RequestLike[];
  /** True when this arrival was already recorded (an album can come in over several checks). */
  alreadySeen?: (key: string) => boolean;
}

export interface CheckResult { cursors: Cursors; notices: Notice[] }

/**
 * One pass over Sonarr and Lidarr history. The first time a source is seen, only the time is recorded:
 * old history is never announced. A failed read keeps the old time, so the next check tries again.
 */
export async function findNewArrivals(input: CheckInput): Promise<CheckResult> {
  const cursors: Cursors = { ...input.cursors };
  const notices: Notice[] = [];
  const since = (cursor: string) => new Date(Math.max(Date.parse(cursor), Date.parse(input.now) - MAX_LOOKBACK_MS));

  if (input.sonarr) {
    if (!cursors.sonarr) {
      cursors.sonarr = input.now;
    } else {
      try {
        const from = cursors.sonarr;
        const imports = (await input.sonarr.getRecentImports(since(from))).filter(i =>
          !i.upgrade && Date.parse(i.at) > Date.parse(from) && !isRequestDriven(i.seriesId, i.at, input.requests));
        notices.push(...episodeNotices(imports));
        cursors.sonarr = input.now;
      } catch { /* Sonarr is unreachable: the same window is read again next time */ }
    }
  }

  if (input.lidarr) {
    if (!cursors.lidarr) {
      cursors.lidarr = input.now;
    } else {
      try {
        const from = cursors.lidarr;
        const imports = (await input.lidarr.getRecentImports(since(from))).filter(i =>
          !i.upgrade && Date.parse(i.at) > Date.parse(from) && !isRequestDriven(i.artistId, i.at, input.requests));
        notices.push(...albumNotices(imports).filter(n => !input.alreadySeen?.(n.key)));
        cursors.lidarr = input.now;
      } catch { /* Lidarr is unreachable: the same window is read again next time */ }
    }
  }
  return { cursors, notices };
}

// ---------------------------------------------------------------- storage and the timer

const cursorFile = () => resolve(DATA_DIR, 'new-arrivals.json');

function readCursors(): Cursors {
  try {
    const path = cursorFile();
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Cursors;
    return { sonarr: parsed.sonarr, lidarr: parsed.lidarr };
  } catch {
    return {};
  }
}

function writeCursors(cursors: Cursors): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(cursorFile(), JSON.stringify(cursors));
  } catch { /* the next check simply starts from the same place */ }
}

function recordArrival(n: Notice): void {
  try {
    run('INSERT OR IGNORE INTO new_arrivals (arrival_key, kind, media_id, detail, arrived_at) VALUES (?, ?, ?, ?, ?)',
      n.key, n.type === 'library.new-episode' ? 'episode' : 'album', n.mediaId, n.detail, n.at);
    // Only the last 30 days are ever shown.
    run('DELETE FROM new_arrivals WHERE arrived_at < ?', new Date(Date.now() - 30 * 86_400_000).toISOString());
  } catch { /* a missing rail entry must not stop the notices */ }
}

const seen = (key: string) => !!get<{ arrival_key: string }>('SELECT arrival_key FROM new_arrivals WHERE arrival_key = ?', key);

async function runCheck(): Promise<void> {
  let sonarr: SonarrAdapter | undefined;
  let lidarr: LidarrAdapter | undefined;
  try { sonarr = getAdapter<SonarrAdapter>('sonarr'); } catch { /* not registered */ }
  try { lidarr = getAdapter<LidarrAdapter>('lidarr'); } catch { /* not registered */ }
  const now = new Date().toISOString();
  const result = await findNewArrivals({
    now, cursors: readCursors(), sonarr, lidarr, requests: getRequests(), alreadySeen: seen
  });
  writeCursors(result.cursors);
  if (!result.notices.length) return;

  // Who follows what: the library's artists are needed for administrators.
  let libraryArtistIds: string[] = [];
  if (result.notices.some(n => n.type === 'library.new-release')) {
    try { libraryArtistIds = ((await lidarr?.getItems()) ?? []).map(a => a.id); } catch { /* admins then hear only about followed artists */ }
  }
  const users = listUsers().map(u => ({ userId: u.id, role: u.role }));
  const follows = followsByUser(loadFollowInputs(users, libraryArtistIds));

  for (const n of result.notices) {
    recordArrival(n);
    // New episodes: find their intro and credits in the background (already-checked files are skipped).
    if (n.type === 'library.new-episode') void detectSeries(n.mediaId).catch(() => undefined);
    for (const [userId, f] of follows) {
      const wanted = n.type === 'library.new-episode' ? f.series.has(n.mediaId) : f.artists.has(n.mediaId);
      if (!wanted) continue;
      notify({ type: n.type, title: n.title, ...(n.body ? { body: n.body } : {}), link: n.link, userId });
    }
  }
}

/** Checks Sonarr and Lidarr history every 10 minutes, starting two minutes after the server does. */
export function startNewArrivalWatch(): void {
  const tick = () => void runCheck().catch(() => undefined);
  setTimeout(tick, 2 * 60_000).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}
