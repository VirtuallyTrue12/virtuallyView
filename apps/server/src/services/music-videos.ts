import path from 'node:path';
import { all, get, run } from '../db/app-db.js';
import type { TorrentInfo } from '@virtuallyview/integrations';
import { cleanReleaseName } from './names.js';

/**
 * Concerts and music videos. A finished download that is a concert or a music
 * video (and not something Radarr, Sonarr or Lidarr manages) is moved under its
 * artist as <artist folder>/Concerts or /Videos. The artist is created in the
 * library, without downloading anything, when it is new. When the artist cannot
 * be worked out with confidence the download waits for a person to say who it is.
 */

export type VideoKind = 'Concerts' | 'Videos';
export type JobStatus = 'filed' | 'needs_artist' | 'error' | 'skipped';

export const VIDEO_EXT = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.ts', '.m2ts', '.webm', '.wmv', '.mpg', '.mpeg', '.vob']);
/** Categories the person chose when they picked a release by hand (see release-picker). */
const EXPLICIT_KIND: Record<string, VideoKind> = { 'vv-concerts': 'Concerts', 'vv-videos': 'Videos' };
const MANAGED_CATEGORIES = new Set(['radarr', 'sonarr', 'lidarr', 'movies', 'tv', 'music', 'series']);

const CONCERT_RE = /\b(live (?:at|in|from|on|@|aid|8)|live \d{4}|in concert|concert|unplugged|world tour|tour \d{4}|farewell tour|festival|rock in rio|glastonbury|wembley|acoustic sessions?)\b/i;
const VIDEO_RE = /\b(music videos?|video (?:collection|anthology)|videography|greatest (?:hits )?videos?|the videos|mtv (?:unplugged|video))\b/i;
const EPISODE_RE = /\bs\d{1,2}e\d{1,3}\b|\bseason \d+\b/i;

/** Is this release name a concert or music video? Kind is by keywords: "live at", "concert", "tour" are concerts. */
export function classifyMusicVideo(rawName: string): VideoKind | null {
  if (EPISODE_RE.test(rawName)) return null;
  const name = rawName.replace(/[._]+/g, ' ');
  if (CONCERT_RE.test(name)) return 'Concerts';
  if (VIDEO_RE.test(name)) return 'Videos';
  return null;
}

const GENERIC = new Set(['rock', 'pop', 'metal', 'live', 'concert', 'music', 'video', 'videos', 'the', 'hd', 'full', 'dvd', 'bluray', 'various artists', 'various']);

/** "Foo Fighters - Live at Wembley 2008 1080p" to ["Foo Fighters"]. Best guesses first. */
export function artistGuesses(rawName: string): string[] {
  const name = cleanReleaseName(rawName).replace(/\b(?:19|20)\d{2}\b/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const out: string[] = [];
  const dash = /^(.{2,60}?)\s+[-–—]\s+.+$/.exec(name);
  if (dash) out.push(dash[1]!);
  const live = /^(.{2,60}?)\s+(?:live\b|in concert\b|unplugged\b|concert\b|world tour\b|farewell tour\b|tour\b|music videos?\b|video collection\b|videography\b|the videos?\b)/i.exec(name);
  if (live) out.push(live[1]!);
  const seen = new Set<string>();
  return out.map(g => g.replace(/^the\s+(?=.+\s+-\s)/i, '').replace(/[\s\-]+$/, '').trim())
    .filter(g => g.length >= 2 && !GENERIC.has(g.toLowerCase()) && !seen.has(g.toLowerCase()) && !!seen.add(g.toLowerCase()));
}

export function normalizeArtist(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

export interface ArtistFolder { id: number; name: string; path: string }

export interface FilerDeps {
  qbit: {
    listTorrents(): Promise<TorrentInfo[]>;
    torrentFiles(hash: string): Promise<string[]>;
    setLocation(hash: string, location: string): Promise<{ success: boolean; message: string }>;
  };
  lidarr: {
    listArtistFolders(): Promise<ArtistFolder[]>;
    lookupCandidates(name: string): Promise<Array<{ title: string }>>;
    addArtistQuietly(name: string): Promise<ArtistFolder | { failure: string }>;
  };
}

/** Finds the artist in the library, or creates them. Null when the name is not a known artist. */
export async function resolveArtist(guesses: string[], deps: FilerDeps): Promise<{ artist: ArtistFolder; created: boolean } | { failure: string }> {
  const library = await deps.lidarr.listArtistFolders();
  for (const guess of guesses) {
    const wanted = normalizeArtist(guess);
    const hit = library.find(a => normalizeArtist(a.name) === wanted) ?? library.find(a => similarity(normalizeArtist(a.name), wanted) >= 0.9);
    if (hit) return { artist: hit, created: false };
  }
  for (const guess of guesses) {
    const candidates = await deps.lidarr.lookupCandidates(guess).catch(() => []);
    const wanted = normalizeArtist(guess);
    // A guess must match a real artist closely; otherwise it is likely part of the title, not a name.
    const best = candidates.find(c => similarity(normalizeArtist(c.title), wanted) >= 0.9);
    if (!best) continue;
    const already = library.find(a => normalizeArtist(a.name) === normalizeArtist(best.title));
    if (already) return { artist: already, created: false };
    const added = await deps.lidarr.addArtistQuietly(best.title);
    if ('failure' in added) return { failure: added.failure };
    return { artist: added, created: true };
  }
  return { failure: guesses.length ? `Could not tell which artist "${guesses[0]}" is.` : 'The name does not say which artist this is.' };
}

interface JobRow { hash: string; name: string; status: JobStatus; kind: VideoKind; artist_id: number | null; artist_name: string | null; message: string; updated_at: string }

function saveJob(hash: string, name: string, status: JobStatus, kind: VideoKind, artist: { id: number; name: string } | null, message = ''): void {
  run(`INSERT INTO music_video_jobs (hash, name, status, kind, artist_id, artist_name, message, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET name = excluded.name, status = excluded.status, kind = excluded.kind, artist_id = excluded.artist_id, artist_name = excluded.artist_name, message = excluded.message, updated_at = excluded.updated_at`,
    hash, name, status, kind, artist?.id ?? null, artist?.name ?? null, message, new Date().toISOString());
}

export function listJobs(status?: JobStatus): Array<{ hash: string; name: string; status: JobStatus; kind: VideoKind; artistId: number | null; artistName: string | null; message: string; updatedAt: string }> {
  const rows = status ? all<JobRow>('SELECT * FROM music_video_jobs WHERE status = ? ORDER BY updated_at DESC', status) : all<JobRow>('SELECT * FROM music_video_jobs ORDER BY updated_at DESC LIMIT 50');
  return rows.map(r => ({ hash: r.hash, name: r.name, status: r.status, kind: r.kind, artistId: r.artist_id, artistName: r.artist_name, message: r.message, updatedAt: r.updated_at }));
}

export interface FileOutcome { status: JobStatus; artist?: ArtistFolder; created?: boolean; kind: VideoKind; message: string }

/** Files one finished torrent under its artist. `artistName` is a person's answer and beats guessing. */
export async function fileTorrent(torrent: TorrentInfo, deps: FilerDeps, opts: { artistName?: string; kind?: VideoKind } = {}): Promise<FileOutcome> {
  const kind = opts.kind ?? EXPLICIT_KIND[torrent.category.toLowerCase()] ?? classifyMusicVideo(torrent.name) ?? 'Videos';
  const guesses = opts.artistName ? [opts.artistName] : artistGuesses(torrent.name);
  try {
    const resolved = await resolveArtist(guesses, deps);
    if ('failure' in resolved) {
      saveJob(torrent.hash, torrent.name, 'needs_artist', kind, null, resolved.failure);
      return { status: 'needs_artist', kind, message: resolved.failure };
    }
    const target = path.posix.join(resolved.artist.path.replace(/\\/g, '/'), kind);
    const moved = await deps.qbit.setLocation(torrent.hash, target);
    if (!moved.success) {
      saveJob(torrent.hash, torrent.name, 'error', kind, resolved.artist, moved.message);
      return { status: 'error', artist: resolved.artist, kind, message: moved.message };
    }
    const message = `Filed under ${resolved.artist.name} / ${kind}${resolved.created ? ' (new artist added to the library)' : ''}.`;
    saveJob(torrent.hash, torrent.name, 'filed', kind, resolved.artist, message);
    return { status: 'filed', artist: resolved.artist, created: resolved.created, kind, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Filing failed.';
    saveJob(torrent.hash, torrent.name, 'error', kind, null, message);
    return { status: 'error', kind, message };
  }
}

/** Which finished, unmanaged torrents are concerts or videos that have not been dealt with yet. */
export async function findCandidates(deps: FilerDeps): Promise<TorrentInfo[]> {
  const torrents = await deps.qbit.listTorrents();
  // Failed moves are tried again after ten minutes, not every sweep.
  const recent = new Date(Date.now() - 10 * 60_000).toISOString();
  const done = new Set(all<{ hash: string }>('SELECT hash FROM music_video_jobs WHERE status != ? OR updated_at > ?', 'error', recent).map(r => r.hash));
  const found: TorrentInfo[] = [];
  for (const t of torrents) {
    if (t.progress < 100 || done.has(t.hash)) continue;
    if (MANAGED_CATEGORIES.has(t.category.toLowerCase())) continue;
    if (!EXPLICIT_KIND[t.category.toLowerCase()] && !classifyMusicVideo(t.name)) continue;
    // Already sitting in an artist's Concerts/Videos folder: nothing to do.
    if (/[\\/](Concerts|Videos)([\\/]|$)/.test(t.savePath)) continue;
    const files = await deps.qbit.torrentFiles(t.hash).catch(() => []);
    if (!files.some(f => VIDEO_EXT.has(path.extname(f).toLowerCase()))) continue;
    found.push(t);
  }
  return found;
}

export async function sweepMusicVideos(deps: FilerDeps): Promise<FileOutcome[]> {
  const outcomes: FileOutcome[] = [];
  for (const torrent of await findCandidates(deps)) outcomes.push(await fileTorrent(torrent, deps));
  return outcomes;
}

export function jobFor(hash: string) {
  return get<JobRow>('SELECT * FROM music_video_jobs WHERE hash = ?', hash);
}
