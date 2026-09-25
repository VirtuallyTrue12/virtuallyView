export type MediaType = 'movie' | 'series' | 'season' | 'episode' | 'album' | 'track' | 'artist';

export interface Media {
  id: string;
  title: string;
  originalTitle?: string;
  type: MediaType;
  year?: number;
  status: MediaStatus;
  quality?: string;
  provider?: ProviderReference;
  artwork?: ArtworkSet;
  genres?: string[];
  rating?: number;
  overview?: string;
  /** Age rating such as PG-13 or TV-MA, when the media manager knows it. */
  certification?: string;
  /** Franchise or collection name (movies). */
  collection?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type MediaStatus = 'available' | 'missing' | 'requested' | 'downloading' | 'importing' | 'paused' | 'failed' | 'offline' | 'unknown';

export interface ProviderReference {
  name: string;
  id: string | number;
  metadata?: Record<string, unknown>;
}

export interface ArtworkSet {
  poster?: string;
  backdrop?: string;
  thumbnail?: string;
}

export interface Movie extends Media {
  runtime?: number;
  director?: Person[];
  cast?: Person[];
  studio?: string;
  releaseInfo?: string;
  fileInfo?: FileInfo;
}

export interface Series extends Media {
  seasons?: Season[];
  nextAirDate?: Date;
}

export interface Season {
  number: number;
  episodes: Episode[];
  overview?: string;
}

export interface Episode {
  number: number;
  title: string;
  airDate?: Date;
  fileInfo?: FileInfo;
}

export interface Person {
  id: string;
  name: string;
  role?: 'director' | 'actor' | 'musician';
}

export interface FileInfo {
  path?: string;
  size?: number;
  duration?: number;
}

export interface IntegrationStatus {
  name: string;
  adapter: string;
  enabled: boolean;
  healthStatus: string;
  url: string;
  lastSync?: Date;
  version?: string;
  setupRequired?: boolean;
}

export interface Download {
  id: string;
  title?: string;
  mediaId?: string;
  timeleft?: string;
  /** Upstream transfer identity, e.g. the torrent hash reported by an *arr queue. */
  downloadId?: string;
  sourceClient: string;
  status: string;
  /** Why an item needs attention, in plain words (for example an import that failed). */
  statusMessage?: string;
  progress?: number;
  speed?: number;
  eta?: Date;
  size?: number;
  /** Where the download client stores this item on disk (when it reports one). */
  savePath?: string;
  associatedMedia?: { type: string; title: string; id: string };
  /** The download client's own label (qBittorrent category), such as radarr, sonarr or lidarr. */
  category?: string;
}

export interface ActivityEvent {
  id: string;
  timestamp: Date;
  service: string;
  type: string;
  media?: { title: string; id: string; type: string };
  status: string;
  humanReadable: string;
  retryable?: boolean;
  technicalDetails?: Record<string, unknown>;
}
