import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { LidarrAdapter, QBittorrentAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';
import { isAllowedMediaFile } from './media-roots.js';
import { cleanReleaseName } from './names.js';
import { VIDEO_EXT, sweepMusicVideos, type ArtistFolder, type FilerDeps, type VideoKind } from './music-videos.js';

export interface MusicVideo { id: string; title: string; kind: VideoKind; sizeBytes: number; folder: string }

const KINDS: VideoKind[] = ['Concerts', 'Videos'];
let folders: { at: number; items: ArtistFolder[] } | null = null;

export async function artistFolders(force = false): Promise<ArtistFolder[]> {
  if (!force && folders && Date.now() - folders.at < 30_000) return folders.items;
  const items = await getAdapter<LidarrAdapter>('lidarr').listArtistFolders();
  folders = { at: Date.now(), items };
  return items;
}
export function forgetArtistFolders(): void { folders = null; }

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
const unb64 = (text: string) => Buffer.from(text, 'base64url').toString('utf8');

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

/** Video files in one artist's Concerts and Videos folders. */
export function scanArtistVideos(artist: ArtistFolder): MusicVideo[] {
  const found: MusicVideo[] = [];
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
      found.push({ id: `musicvideo-${artist.id}~${b64(rel)}`, title: withoutArtist(title, artist.name), kind, sizeBytes: statSync(file).size, folder: inRelease ? folder : '' });
    }
  }
  return found;
}

/** The file on disk for a `musicvideo-...` id, only when it is inside that artist's Concerts or Videos folder. */
export async function resolveMusicVideoPath(id: string): Promise<string | null> {
  const match = /^musicvideo-(\d+)~([A-Za-z0-9_-]+)$/.exec(id);
  if (!match) return null;
  const artist = (await artistFolders().catch(() => [])).find(a => String(a.id) === match[1]);
  if (!artist) return null;
  const rel = unb64(match[2]!);
  const first = rel.split(/[\\/]/)[0];
  if (!KINDS.includes(first as VideoKind)) return null;
  const full = path.resolve(artist.path, rel);
  if (!full.startsWith(path.resolve(artist.path) + path.sep)) return null;
  if (!VIDEO_EXT.has(path.extname(full).toLowerCase()) || !existsSync(full)) return null;
  try { if (!realpathSync(full).startsWith(realpathSync(artist.path) + path.sep)) return null; } catch { return null; }
  return isAllowedMediaFile(full) ? full : null;
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
    try { await sweepMusicVideos(liveFilerDeps()); } catch { /* services offline: try again next minute */ } finally { running = false; }
  };
  setTimeout(() => void tick(), 45_000).unref();
  setInterval(() => void tick(), 60_000).unref();
}
