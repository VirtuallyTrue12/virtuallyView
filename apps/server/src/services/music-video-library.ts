import { existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { LidarrAdapter, QBittorrentAdapter, RadarrAdapter } from '@virtuallyview/integrations';
import { concertMoviesOf, sweepConcertMovies } from './concert-movies.js';
import { getAdapter } from './registry.js';
import { isAllowedMediaFile } from './media-roots.js';
import { cleanReleaseName } from './names.js';
import { VIDEO_EXT, sweepMusicVideos, type ArtistFolder, type FilerDeps, type VideoKind } from './music-videos.js';

export interface MusicVideo {
  id: string; title: string; kind: VideoKind; sizeBytes: number; folder: string;
  /** A concert that came in as a film: where to play it, and how far along it is. */
  href?: string; status?: string;
}
interface Found extends MusicVideo { file: string }

const KINDS: VideoKind[] = ['Concerts', 'Videos'];
let folders: { at: number; items: ArtistFolder[] } | null = null;

export async function artistFolders(force = false): Promise<ArtistFolder[]> {
  if (!force && folders && Date.now() - folders.at < 30_000) return folders.items;
  const items = await getAdapter<LidarrAdapter>('lidarr').listArtistFolders();
  folders = { at: Date.now(), items };
  return items;
}
export function forgetArtistFolders(): void { folders = null; }

/** A short, stable id for a file inside an artist's folder: long file names must not make long addresses. */
export const videoKey = (relativePath: string) => createHash('sha1').update(relativePath).digest('base64url').slice(0, 16);

function walk(dir: string, depth: number, out: string[]): void {
  if (depth < 0) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries.sort()) {
    const full = path.join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) walk(full, depth - 1, out);
    else if (VIDEO_EXT.has(path.extname(entry).toLowerCase())) out.push(full);
  }
}

/** "Scorpions - Live in Berlin 2020" on Scorpions' own page reads better as "Live in Berlin 2020". */
function withoutArtist(title: string, artistName: string): string {
  const escaped = artistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trimmed = title.replace(new RegExp(`^${escaped}\\s*[-\u2013:]?\\s+`, 'i'), '').trim();
  return trimmed.length >= 3 ? trimmed : title;
}

function scan(artist: ArtistFolder): Found[] {
  const found: Found[] = [];
  for (const kind of KINDS) {
    const root = path.join(artist.path, kind);
    if (!existsSync(root)) continue;
    const files: string[] = [];
    walk(root, 3, files);
    const perFolder = new Map<string, number>();
    for (const file of files) perFolder.set(path.dirname(file), (perFolder.get(path.dirname(file)) ?? 0) + 1);
    for (const file of files) {
      if (!isAllowedMediaFile(file)) continue;
      const rel = path.relative(artist.path, file);
      const folder = path.dirname(path.relative(root, file));
      const inRelease = folder !== '.';
      const base = cleanReleaseName(path.basename(file));
      // One file in a release folder is named by the release; several are "release: file".
      const title = !inRelease ? base : perFolder.get(path.dirname(file)) === 1 ? cleanReleaseName(folder) : `${cleanReleaseName(folder)}: ${base}`;
      found.push({ id: `musicvideo-${artist.id}~${videoKey(rel)}`, title: withoutArtist(title, artist.name), kind, sizeBytes: statSync(file).size, folder: inRelease ? folder : '', file });
    }
  }
  return found;
}

/** Video files in one artist's Concerts and Videos folders. */
export function scanArtistVideos(artist: ArtistFolder): MusicVideo[] {
  return scan(artist).map(({ file: _file, ...video }) => video);
}

/** The file on disk for one `musicvideo-...` id of an artist, only ever from inside that artist's Concerts or Videos folder. */
export function findMusicVideoFile(artist: ArtistFolder, key: string): string | null {
  const hit = scan(artist).find(v => v.id.endsWith(`~${key}`));
  return hit && isAllowedMediaFile(hit.file) ? hit.file : null;
}

export async function resolveMusicVideoPath(id: string): Promise<string | null> {
  const match = /^musicvideo-(\d+)~([A-Za-z0-9_-]{16})$/.exec(id);
  if (!match) return null;
  const artist = (await artistFolders().catch(() => [])).find(a => String(a.id) === match[1]);
  return artist ? findMusicVideoFile(artist, match[2]!) : null;
}

/** Concerts of this artist that were added as films, ready to play from the film player. */
export async function concertFilmsOf(artist: ArtistFolder): Promise<MusicVideo[]> {
  const ids = concertMoviesOf(artist.id);
  if (ids.length === 0) return [];
  const films = await getAdapter<RadarrAdapter>('radarr').getItems().catch(() => []) as unknown as Array<{ id: string; title: string; status?: string; fileInfo?: { size?: number } }>;
  // A film with no file and nothing coming is not a concert to watch yet: leave it off the artist page.
  return films.filter(f => ids.includes(f.id) && ['available', 'downloading', 'importing'].includes(f.status ?? '')).map(f => ({
    id: f.id, title: withoutArtist(f.title, artist.name), kind: 'Concerts' as const, sizeBytes: f.fileInfo?.size ?? 0, folder: '',
    href: `/movies/${encodeURIComponent(f.id)}${f.status === 'available' ? '/play' : ''}`, status: f.status ?? 'requested'
  }));
}

export function liveFilerDeps(): FilerDeps {
  const lidarr = getAdapter<LidarrAdapter>('lidarr');
  return {
    qbit: getAdapter<QBittorrentAdapter>('qbittorrent'),
    lidarr: {
      listArtistFolders: () => lidarr.listArtistFolders(),
      lookupCandidates: name => lidarr.lookupCandidates(name),
      addArtistQuietly: async name => { const r = await lidarr.addArtistQuietly(name); forgetArtistFolders(); return r; }
    }
  };
}

/** Looks for finished concert and video downloads every minute and files them. */
export function startMusicVideoFiler(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const deps = liveFilerDeps();
      await sweepMusicVideos(deps);
      // Concerts that arrived as films (Radarr) belong with their artist.
      await sweepConcertMovies(await getAdapter<RadarrAdapter>('radarr').getItems() as never, deps);
    } catch { /* services offline: try again next minute */ } finally { running = false; }
  };
  setTimeout(() => void tick(), 45_000).unref();
  setInterval(() => void tick(), 60_000).unref();
}
