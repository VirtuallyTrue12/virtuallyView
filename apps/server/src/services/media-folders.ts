import type { RadarrAdapter, SonarrAdapter, LidarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';

export type FolderKind = 'movies' | 'tv' | 'music' | 'photos' | 'books';

const ENV_VAR: Record<FolderKind, string> = { movies: 'MOVIES_DIR', tv: 'TV_DIR', music: 'MUSIC_DIR', photos: 'PHOTOS_DIR', books: 'BOOKS_DIR' };
const MOUNT_PATH: Record<FolderKind, string> = { movies: '/media/movies', tv: '/media/tv', music: '/media/music', photos: '/media/photos', books: '/media/books' };
const ARR_SERVICE: Partial<Record<FolderKind, 'radarr' | 'sonarr' | 'lidarr'>> = { movies: 'radarr', tv: 'sonarr', music: 'lidarr' };

export interface MediaFolderInfo {
  kind: FolderKind;
  /** The real path on your computer, when this library uses one (see docs/existing-media.md); null for Docker-managed storage. */
  hostPath: string | null;
  /**
   * Extra root folders the media manager has configured beyond the one this app mounts - a second
   * drive, say. Shown as container paths (this app has no host equivalent to translate them to), so
   * they only mean something read directly on the server machine.
   */
  extraFolders: string[];
}

/** Where one library's files really live: the host folder (if any) plus any extra root folders the media manager itself knows about. */
export async function mediaFolderInfo(kind: FolderKind): Promise<MediaFolderInfo> {
  const hostPath = process.env[ENV_VAR[kind]]?.trim() || null;
  const arrService = ARR_SERVICE[kind];
  let extraFolders: string[] = [];
  if (arrService) {
    try {
      const roots = await (getAdapter(arrService) as RadarrAdapter | SonarrAdapter | LidarrAdapter).rootFolders();
      extraFolders = roots.filter(p => p !== MOUNT_PATH[kind]);
    } catch {
      // The media manager is offline: still show whatever host path is configured.
    }
  }
  return { kind, hostPath, extraFolders };
}
