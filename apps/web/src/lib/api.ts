export type ItemStatus = 'available' | 'missing' | 'requested' | 'downloading' | 'importing' | 'paused';

export interface MediaItem {
  id: string;
  title: string;
  type?: string;
  year?: number;
  status?: string;
  quality?: string;
  rating?: number;
  runtime?: number;
  genres?: string[];
  overview?: string;
  tagline?: string;
  releaseDate?: string;
  language?: string;
  streamUrl?: string;
  cast?: { name: string; role: string; photo?: string }[];
  director?: { name: string }[];
  artwork?: { poster?: string; backdrop?: string };
  albumCount?: number;
  trackFileCount?: number;
  totalTrackCount?: number;
  sizeOnDisk?: number;
  watchProgress?: number;
  createdAt?: string;
  favorite?: boolean;
  watched?: boolean;
  certification?: string;
  collection?: string;
  studio?: string;
  /** Set on Next Up tiles, such as "S2 E4". */
  nextEpisode?: string;
  warnings?: Array<{ code: 'in-cinemas' | 'camera-copy' | 'suspect-file'; message: string }>;
}

export interface DownloadItem {
  id: string;
  sourceClient?: string;
  reportedBy?: string[];
  actions?: Array<'pause' | 'resume' | 'remove' | 'delete-files'>;
  title: string;
  year?: number;
  progress: number;
  status: string;
  speed?: string;
  eta?: string;
  size?: string;
  savePath?: string;
  mediaId?: string;
  mediaType?: string;
  requestId?: string;
  artwork?: { poster?: string; backdrop?: string };
  rawTitle?: string;
  qualityLabel?: string;
  message?: string;
}

export interface HeroCandidate extends MediaItem {
  tagline: string;
  inLibrary: boolean;
}

export type RequestStatus =
  | 'pending'
  | 'searching'
  | 'downloading'
  | 'importing'
  | 'available'
  | 'failed'
  | 'cancelled';

export type MediaKind = 'movie' | 'series' | 'artist';

export interface RequestItem {
  id: string;
  title: string;
  year?: number;
  overview?: string;
  status: RequestStatus;
  service: string;
  mediaType: MediaKind;
  progress?: number;
  qualityProfile?: string;
  rootFolder?: string;
  requester?: string;
  events?: Array<{ at: string; text: string }>;
  selectedProviderId?: string;
  providerId?: string;
  metadataProvider?: string;
  message?: string;
  download?: { count: number; progress: number; status: string; speed?: string; eta?: string; size?: string; sourceClient?: string };
  createdAt: string;
  updatedAt: string;
}

export interface SeriesSeason {
  number: number;
  episodes: number;
  availableEpisodes?: number;
  year?: number;
  overview?: string;
}

export interface SeriesItem extends MediaItem {
  seasons?: SeriesSeason[];
}

export interface EpisodeItem {
  id: string;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string;
  overview?: string;
  runtime?: number;
  hasFile: boolean;
  streamUrl?: string;
  watchProgress?: number;
  watched?: boolean;
}

export interface SubtitleTrack {
  src: string;
  label: string;
  srclang: string;
  default?: boolean;
}

export interface IntegrationStatus {
  name: string;
  adapter: string;
  enabled: boolean;
  healthStatus: string;
  url: string;
  lastSync: string | null;
  setupRequired?: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
  avatar?: string;
  maxRating?: string;
}

export interface Lyrics {
  plain: string | null;
  synced: Array<{ time: number; text: string }> | null;
}

export interface AuthStatus {
  enabled: boolean;
  setupRequired: boolean;
  signupOpen?: boolean;
  authenticated: boolean;
  user: AuthUser | null;
}

export interface AuthBackdrop {
  title: string;
  poster?: string;
  backdrop?: string;
}

export interface StorageReport {
  roots: Array<{ name: string; path: string; exists: boolean; bytes: number; files: number }>;
  mediaBytes: number;
  mediaFiles: number;
  disk: { totalBytes: number; freeBytes: number; usedBytes: number } | null;
  truncated: boolean;
  computedAt: string;
}

export interface MediaPlaybackInfo {
  playable: boolean;
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  durationSeconds: number | null;
  reason: string | null;
  transcodingAvailable: boolean;
  width?: number | null;
  height?: number | null;
  bitrate?: number | null;
  sizeBytes?: number | null;
  audioTracks?: Array<{ index: number; codec: string; language: string; title: string; channels: number | null }>;
  subtitleStreams?: Array<{ index: number; codec: string; language: string; title: string; text: boolean }>;
  chapters?: Array<{ start: number; end: number; title: string }>;
}

export type Rail = {
  id: string;
  title: string;
  kind?: 'media' | 'download';
  href?: string;
  items: (MediaItem & Partial<DownloadItem>)[];
};

export interface Dashboard {
  hero: HeroCandidate;
  heroCandidates: HeroCandidate[];
  rails: Rail[];
}

export interface SearchResults {
  query: string;
  total: number;
  items: MediaItem[];
}

export interface SearchDetection {
  kind: 'movie' | 'series' | 'artist' | 'track' | 'ambiguous';
  query: string;
  source: 'library' | 'metadata' | 'musicbrainz' | 'ambiguous';
  title?: string;
  year?: number;
  artist?: string;
  track?: { title: string; artist: string; year?: number; owned?: boolean };
  candidates: Array<{
    provider: 'tmdb' | 'tvdb' | 'musicbrainz';
    providerId: string;
    title: string;
    year?: number;
    type: 'movie' | 'series' | 'artist';
    overview?: string;
  }>;
}

export interface AiHealth {
  configured: boolean;
  provider: string;
  model: string | null;
  healthy: boolean;
}

export interface AiTool {
  name: string;
  description: string;
  permission: 'read' | 'request' | 'manage' | 'destructive';
  requiresConfirmation: boolean;
}

export interface AiModel {
  id: string;
  name: string;
}

export type SearchSuggestion =
  | { title: string; year?: number; type?: string; id: string; source: 'library'; poster?: string | null }
  | { title: string; description: string; source: 'web' };

export interface PullStatus {
  model: string;
  status: 'running' | 'done' | 'error' | 'unknown';
  message?: string;
}

export interface SourceCheck {
  name: string;
  kind: string;
  ok: boolean;
  detail: string;
}

export interface VerifyResult {
  id: string;
  title: string;
  type?: string;
  verified: boolean;
  checks: SourceCheck[];
}

export interface MediaDescription {
  id: string;
  title: string;
  description: string;
  source: string;
}

export interface WatchProgress {
  mediaType: string;
  mediaId: string;
  positionSeconds: number;
  durationSeconds: number;
  percent: number;
  updatedAt?: string;
}

export interface AlbumItem {
  id: number;
  title: string;
  artistId: number;
  albumType?: string;
  releaseDate?: string;
  duration?: number;
  mediumCount?: number;
  ratings?: { votes: number; value: number };
  artwork?: { cover?: string };
}

export interface TrackItem {
  id: number;
  title: string;
  albumId: number;
  trackNumber?: string;
  durationMs?: number;
  hasFile: boolean;
  trackFileId?: number;
  channels?: number;
  audioLabel?: string;
  path?: string;
  size?: number;
  quality?: string;
}

export interface CoverCandidate {
  url: string;
  source: string;
  label?: string;
}

/** One track saved inside a playlist. Snapshot kept so the playlist renders
 *  without a live Music service call, and plays via /api/music/stream/:id. */
export interface PlaylistTrack {
  trackId: string;
  title: string;
  artistTitle?: string;
  albumTitle?: string;
  albumId?: string;
  cover?: string;
  quality?: string;
  durationMs?: number;
}

export interface PlaylistItem {
  id: string;
  name: string;
  tracks: PlaylistTrack[];
  createdAt: string;
  updatedAt: string;
}

export interface ServerSettings {
  serverName: string;
  mediaRoots: { movies: string; tv: string; music: string; staging: string };
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  bindAddress: string;
  port: number;
  folderChangeRequiresConfirmation: boolean;
  coverSource: 'tmdb' | 'duckduckgo' | 'wikipedia';
  outboundProxy: { enabled: boolean; kind: 'tor' | 'socks5' | 'http'; host: string; port: number };
  allowSignup?: boolean;
  publicUrl?: string;
  defaultQuality?: { movie: string; series: string; artist: string };
  requests?: { approval: 'off' | 'users'; limit: number; window: 'day' | 'week' };
  notifications?: { channels: NotificationChannel[] };
  autoBackup?: boolean;
  updatedAt?: string;
}

export type AgentReply =
  | { kind: 'message'; text: string }
  | { kind: 'tool-result'; tool: string; text: string; summary?: unknown }
  | { kind: 'confirmation'; tool: string; arguments: Record<string, unknown>; description: string }
  | { kind: 'error'; message: string };

/** Carries the HTTP status and parsed body so callers can tell a real "not
 *  found" (404) apart from a service outage or a 409 with request candidates. */
export interface AuthSession {
  id: string;
  userId: string;
  username: string;
  device: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface SearchCandidate {
  provider: 'tmdb' | 'tvdb' | 'musicbrainz';
  providerId: string;
  title: string;
  year?: number;
  type: 'movie' | 'series' | 'artist';
  overview?: string;
  poster?: string;
}

export interface SearchAll {
  query: string;
  library: Array<{ id: string; title: string; year?: number; type: string; status?: string; poster?: string; rating?: number }>;
  movies: SearchCandidate[];
  series: SearchCandidate[];
  artists: SearchCandidate[];
  tracks: Array<{ title: string; artist: string; year?: number }>;
}

export interface Indexer { id: number; name: string; protocol: string; privacy: string; enabled: boolean; definitionName: string; failingUntil?: string }
export interface IndexerDefinition { definitionName: string; name: string; protocol: string; privacy: string; language: string; description: string; adult?: boolean }
export interface SetupStatus { items: Array<{ id: string; label: string; ok: boolean; detail: string; href: string }>; complete: boolean }
export interface AppNotification { id: number; type: string; title: string; body: string; link: string; createdAt: string; read: boolean }
export interface NotificationList { unread: number; items: AppNotification[]; events?: Array<{ key: string; label: string }> }
export interface NotificationChannel { id: string; name: string; kind: 'discord' | 'slack' | 'telegram' | 'ntfy' | 'gotify' | 'webhook' | 'email'; enabled: boolean; events: string[]; config: Record<string, string> }
export interface BackupInfo { name: string; size: number; createdAt: string; kind: string }

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function requestJSON<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('virtuallyview:auth-required'));
    }
    throw new ApiError(parsed?.message ?? `Request failed (${res.status})`, res.status, parsed ?? {});
  }
  return res.json();
}

function getJSON<T>(path: string): Promise<T> {
  return requestJSON<T>('GET', path);
}

function postJSON<T>(path: string, body?: unknown): Promise<T> {
  return requestJSON<T>('POST', path, body);
}

function patchJSON<T>(path: string, body?: unknown): Promise<T> {
  return requestJSON<T>('PATCH', path, body);
}

function deleteJSON<T>(path: string): Promise<T> {
  return requestJSON<T>('DELETE', path);
}

export const api = {
  authStatus: () => getJSON<AuthStatus>('/api/auth/status'),
  login: (username: string, password: string, stayLoggedIn?: boolean) => postJSON<AuthStatus>('/api/auth/login', { username, password, stayLoggedIn }),
  signup: (username: string, password: string, stayLoggedIn?: boolean) => postJSON<AuthStatus>('/api/auth/signup', { username, password, stayLoggedIn }),
  setupRepair: () => postJSON<{ ok: boolean; partial: boolean; log: string[] }>('/api/setup/repair'),
  searchMovie: (id: string) => postJSON<{ success: boolean; message: string }>(`/api/movies/${encodeURIComponent(id)}/search`),
  searchSeries: (id: string, episodeId?: string) => postJSON<{ success: boolean; message: string }>(`/api/series/${encodeURIComponent(id)}/search`, episodeId ? { episodeId } : {}),
  searchArtist: (id: string) => postJSON<{ success: boolean; message: string }>(`/api/artists/${encodeURIComponent(id)}/search`),
  retryDownload: (id: string) => postJSON<{ success: boolean; message: string }>(`/api/downloads/${encodeURIComponent(id)}/retry`),
  person: (name: string) => getJSON<{ name: string; photo?: string; bio?: string; url?: string; titles: Array<MediaItem & { role: string }> }>(`/api/people/${encodeURIComponent(name)}`),
  replaceMovieFile: (id: string) => postJSON<{ success: boolean; message: string }>(`/api/movies/${encodeURIComponent(id)}/replace-file`),
  logout: () => postJSON<{ authenticated: boolean }>('/api/auth/logout'),
  quickConnectStart: () => postJSON<{ code: string; secret: string; expiresInSeconds: number }>('/api/auth/quickconnect/start'),
  quickConnectPoll: (secret: string) =>
    getJSON<{ status: 'pending' | 'expired' | 'approved'; user?: AuthUser }>(`/api/auth/quickconnect/poll?secret=${encodeURIComponent(secret)}`),
  quickConnectApprove: (code: string) => postJSON<{ ok: boolean; device: string }>('/api/auth/quickconnect/approve', { code }),
  setAvatar: (avatar: string) => postJSON<{ user: AuthUser }>('/api/auth/profile/avatar', { avatar }),
  setUserLimit: (id: string, maxRating: string) =>
    postJSON<{ users: AuthUser[] }>(`/api/auth/users/${encodeURIComponent(id)}/limit`, { maxRating }),
  lyrics: (artist: string, title: string, album?: string, durationSeconds?: number) =>
    getJSON<Lyrics>(`/api/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}${album ? `&album=${encodeURIComponent(album)}` : ''}${durationSeconds ? `&duration=${Math.round(durationSeconds)}` : ''}`),
  authBackdrop: () => getJSON<{ backdrop: AuthBackdrop | null }>('/api/auth/backdrop'),
  users: () => getJSON<{ users: AuthUser[] }>('/api/auth/users'),
  resetUserPassword: (id: string, password: string) => postJSON<{ ok: boolean }>(`/api/auth/users/${encodeURIComponent(id)}/password`, { password }),
  changePassword: (current: string, next: string) => postJSON<{ ok: boolean }>('/api/auth/password', { current, next }),
  sessions: () => getJSON<{ sessions: AuthSession[] }>('/api/auth/sessions'),
  revokeOtherSessions: () => postJSON<{ ok: boolean; signedOut: number }>('/api/auth/sessions/revoke-others'),
  revokeSession: async (id: string) => {
    const res = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Could not sign that device out.');
  },
  createUser: (username: string, password: string, role: 'admin' | 'user') =>
    postJSON<{ users: AuthUser[] }>('/api/auth/users', { username, password, role }),
  setUserRole: (id: string, role: 'admin' | 'user') =>
    postJSON<{ users: AuthUser[] }>(`/api/auth/users/${encodeURIComponent(id)}/role`, { role }),
  deleteUserAccount: (id: string) => {
    const res = fetch(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.then(async r => {
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? `Could not remove user (${r.status})`);
      }
      return r.json() as Promise<{ users: AuthUser[] }>;
    });
  },
  systemStorage: () => getJSON<StorageReport>('/api/system/storage'),
  mediaInfo: (id: string) => getJSON<MediaPlaybackInfo>(`/api/stream/${encodeURIComponent(id)}/info`),
  episodeInfo: (id: string) => getJSON<MediaPlaybackInfo>(`/api/stream/episode/${encodeURIComponent(id)}/info`),
  dashboard: () => getJSON<Dashboard>('/api/dashboard'),
  movies: () => getJSON<MediaItem[]>('/api/movies'),
  movie: (id: string) => getJSON<MediaItem>(`/api/movies/${encodeURIComponent(id)}`),
  getTrailer: (id: string) => getJSON<{ youtubeId: string | null }>(`/api/media/${encodeURIComponent(id)}/trailer`),
  series: () => getJSON<SeriesItem[]>('/api/series'),
  artists: () => getJSON<MediaItem[]>('/api/artists'),
  artist: (id: string) => getJSON<MediaItem>(`/api/artists/${encodeURIComponent(id)}`),
  artistAlbums: (id: string) => getJSON<{ artistId: string; albums: AlbumItem[] }>(`/api/artists/${encodeURIComponent(id)}/albums`),
  artistTracks: (id: string) => getJSON<{ artistId: string; tracks: TrackItem[] }>(`/api/artists/${encodeURIComponent(id)}/tracks`),
  searchAlbum: (id: string) => postJSON<{ success: boolean; message: string }>(`/api/albums/${encodeURIComponent(id)}/search`),
  album: (id: string) => getJSON<{ album: AlbumItem & { artistTitle?: string }; tracks: TrackItem[] }>(`/api/albums/${encodeURIComponent(id)}`),
  artistCovers: (id: string) => getJSON<{ artistId: string; title: string; candidates: CoverCandidate[]; chosen: string | null }>(`/api/artists/${encodeURIComponent(id)}/covers`),
  chooseArtistCover: (id: string, url: string) =>
    postJSON<{ artistId: string; chosen: string; candidates: CoverCandidate[] }>(`/api/artists/${encodeURIComponent(id)}/covers`, { url }),
  serie: (id: string) => getJSON<SeriesItem>(`/api/series/${encodeURIComponent(id)}`),
  serieEpisodes: (id: string) =>
    getJSON<{ seriesId: string; episodes: EpisodeItem[] }>(`/api/series/${encodeURIComponent(id)}/episodes`),
  subtitles: (streamUrl: string) => getJSON<{ subtitles: SubtitleTrack[] }>(`${streamUrl}/subtitles`),
  playlists: () => getJSON<PlaylistItem[]>('/api/playlists'),
  playlist: (id: string) => getJSON<PlaylistItem>(`/api/playlists/${encodeURIComponent(id)}`),
  createPlaylist: (name: string) => postJSON<PlaylistItem>('/api/playlists', { name }),
  renamePlaylist: (id: string, name: string) => patchJSON<PlaylistItem>(`/api/playlists/${encodeURIComponent(id)}`, { name }),
  deletePlaylist: (id: string) => deleteJSON<{ success: boolean; id: string }>(`/api/playlists/${encodeURIComponent(id)}`),
  addPlaylistTrack: (id: string, track: PlaylistTrack) =>
    postJSON<PlaylistItem>(`/api/playlists/${encodeURIComponent(id)}/tracks`, { track }),
  removePlaylistTrack: (id: string, trackId: string) =>
    deleteJSON<PlaylistItem>(`/api/playlists/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`),
  search: (q: string) => getJSON<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
  searchDetect: (q: string) => getJSON<SearchDetection>(`/api/search/detect?q=${encodeURIComponent(q)}`),
  searchAll: (q: string) => getJSON<SearchAll>(`/api/search/all?q=${encodeURIComponent(q)}`),
  searchCover: (q: string) => getJSON<{ query: string; cover: string }>(`/api/search/cover?q=${encodeURIComponent(q)}`),
  suggestions: (q: string) => getJSON<{ suggestions: SearchSuggestion[] }>(`/api/search/suggestions?q=${encodeURIComponent(q)}`),
  downloads: () => getJSON<DownloadItem[]>('/api/downloads'),
  pauseDownload: (id: string) => postJSON<{ id: string; success: boolean; message: string }>(`/api/downloads/${encodeURIComponent(id)}/pause`),
  resumeDownload: (id: string) => postJSON<{ id: string; success: boolean; message: string }>(`/api/downloads/${encodeURIComponent(id)}/resume`),
  removeDownload: (id: string) => postJSON<{ success: boolean; id: string }>(`/api/downloads/${encodeURIComponent(id)}/remove`),
  deleteDownloadFiles: (id: string) => postJSON<{ success: boolean; id: string; message: string }>(`/api/downloads/${encodeURIComponent(id)}/delete-files`),
  requests: async () => {
    const result = await getJSON<{ items: RequestItem[] }>('/api/requests?limit=100');
    return result.items;
  },
  request: (id: string) => getJSON<RequestItem>(`/api/requests/${encodeURIComponent(id)}`),
  indexers: () => getJSON<{ indexers: Indexer[] }>('/api/indexers'),
  indexerCatalog: (q: string, adult = false) => getJSON<{ indexers: IndexerDefinition[]; totalPublic: number; totalAdult: number }>(`/api/indexers/catalog?q=${encodeURIComponent(q)}${adult ? '&adult=1' : ''}`),
  addIndexer: (definitionName: string) => postJSON<{ success: boolean; message: string }>('/api/indexers', { definitionName }),
  testIndexer: (id: number) => postJSON<{ success: boolean; message: string }>(`/api/indexers/${id}/test`),
  removeIndexer: (id: number) => requestJSON<{ success: boolean; message: string }>('DELETE', `/api/indexers/${id}`),
  setupStatus: () => getJSON<SetupStatus>('/api/setup/status'),
  notifications: () => getJSON<NotificationList>('/api/notifications'),
  markNotificationsRead: (body: { ids?: number[]; all?: boolean }) => postJSON<NotificationList>('/api/notifications/read', body),
  testChannel: (channel: NotificationChannel) => postJSON<{ ok: boolean }>('/api/notifications/test', { channel }),
  backups: () => getJSON<{ backups: BackupInfo[] }>('/api/backup'),
  createBackup: () => postJSON<{ backup: BackupInfo; backups: BackupInfo[] }>('/api/backup'),
  deleteBackup: (name: string) => requestJSON<{ backups: BackupInfo[] }>('DELETE', `/api/backup/${encodeURIComponent(name)}`),
  restoreBackup: (name: string) => postJSON<{ ok: boolean; message: string }>(`/api/backup/${encodeURIComponent(name)}/restore`),
  uploadRestore: async (file: File) => {
    const res = await fetch('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: file });
    const body = await res.json().catch(() => ({})) as { message?: string };
    if (!res.ok) throw new Error(body.message ?? `Restore failed (${res.status})`);
    return body as { ok: boolean; message: string };
  },
  qualityProfiles: (mediaType: string) => getJSON<{ profiles: Array<{ id: number; name: string }>; defaultName: string }>(`/api/quality-profiles?mediaType=${encodeURIComponent(mediaType)}`),
  titleQuality: (mediaType: string, id: string) => getJSON<{ profiles: Array<{ id: number; name: string }>; current: number | null }>(`/api/quality/${encodeURIComponent(mediaType)}/${encodeURIComponent(id)}`),
  setTitleQuality: (mediaType: string, id: string, profileId: number, search = true) => postJSON<{ success: boolean; message: string }>(`/api/quality/${encodeURIComponent(mediaType)}/${encodeURIComponent(id)}`, { profileId, search }),
  createRequest: (body: { title: string; year?: number; overview?: string; mediaType?: MediaKind; selectedProviderId?: string; qualityProfile?: string }) =>
    postJSON<{ ok: boolean; request?: RequestItem; message?: string; code?: string }>('/api/requests', body),
  approveRequest: (id: string) => postJSON<RequestItem>(`/api/requests/${encodeURIComponent(id)}/approve`),
  cancelRequest: (id: string) => postJSON<RequestItem>(`/api/requests/${encodeURIComponent(id)}/cancel`),
  integrations: () => getJSON<IntegrationStatus[]>('/api/integrations'),
  integrationsDetect: () => getJSON<Array<{ adapter: string; url: string; reachable: boolean }>>('/api/integrations/detect'),
  onboardingStatus: () => getJSON<{ required: boolean }>('/api/onboarding'),
  completeOnboarding: () => postJSON<{ required: boolean }>('/api/onboarding', { complete: true }),
  aiHealth: () => getJSON<AiHealth>('/api/ai/health'),
  aiTools: () => getJSON<{ tools: AiTool[] }>('/api/ai/tools'),
  aiModels: () => getJSON<{ models: AiModel[] }>('/api/ai/models'),
  aiPullModel: (model: string) => postJSON<{ success: boolean; model: string; status: string }>('/api/ai/pull', { model }),
  aiPullStatus: (model: string) => getJSON<PullStatus>(`/api/ai/pull/${encodeURIComponent(model)}/status`),
  themes: () => getJSON<ThemeSummary[]>('/api/themes'),
  importTheme: (theme: unknown, tokens: unknown) => postJSON<{ success: boolean; id: string; name: string }>('/api/themes/import', { theme, tokens }),
  deleteTheme: async (id: string) => { const r = await fetch(`/api/themes/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message ?? 'Could not remove theme.'); },
  serviceStatus: () => getJSON<{ running: number; services: string[]; error?: string }>('/api/services/status'),
  serviceConfig: () => getJSON<Record<string, { url: string; apiKey: string; hasCredentials?: boolean; enabled?: boolean }>>('/api/services/config'),
  launchServices: () => postJSON<{ launched: boolean; message: string }>('/api/services/launch'),
  checkUpdate: () => getJSON<{ available: boolean; currentVersion?: string; latestVersion?: string; releaseName?: string; publishedAt?: string; url?: string; notes?: string; message?: string }>('/api/services/check-update'),
  stopService: (service: string) => postJSON<{ stopped: boolean; message: string }>(`/api/services/stop/${encodeURIComponent(service)}`),
  startService: (service: string) => postJSON<{ started: boolean; message: string }>(`/api/services/start/${encodeURIComponent(service)}`),
  theme: (id: string) => getJSON<ThemeDetail>(`/api/themes/${encodeURIComponent(id)}`),
  activeTheme: () => getJSON<ThemeDetail & { id: string }>(`/api/themes/active`),
  activateTheme: (id: string) => postJSON<{ success: boolean; activeTheme: string; cssVars: Record<string, string> }>(`/api/themes/${encodeURIComponent(id)}/activate`),
  aiChat: (body: {
    message: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
    confirm?: { tool: string; arguments: Record<string, unknown> };
  }) => postJSON<AgentReply>('/api/ai/chat', body),
  verifyMedia: (id: string) => getJSON<VerifyResult>(`/api/media/${encodeURIComponent(id)}/verify`),
  mediaDescription: (id: string) => getJSON<MediaDescription>(`/api/media/${encodeURIComponent(id)}/description`),
  movieCast: (id: string) => getJSON<{ mediaId: string; title: string; cast: { name: string; role: string; photo?: string }[]; source: string }>(`/api/movies/${encodeURIComponent(id)}/cast`).then(r => r.cast),
  toggleIntegration: (adapter: string) =>
    postJSON<IntegrationStatus>(`/api/integrations/${encodeURIComponent(adapter)}/toggle`),
  saveIntegrationConfig: (adapter: string, body: { url: string; apiKey: string }) =>
    postJSON<IntegrationStatus & { message?: string }>(`/api/integrations/${encodeURIComponent(adapter)}/config`, body),
  aiPermissions: () => getJSON<{ level: string; levels: string[] }>('/api/ai/permissions'),
  setAiPermissions: (level: string) => postJSON<{ level: string }>('/api/ai/permissions', { level }),
  aiHistory: () => getJSON<{ history: AiActionRecord[] }>('/api/ai/history'),
  activity: () => getJSON<ActivityEvent[]>('/api/activity'),
  progress: (mediaType: string, mediaId: string) => getJSON<WatchProgress>(`/api/progress/${encodeURIComponent(mediaType)}/${encodeURIComponent(mediaId)}`),
  saveProgress: (mediaType: string, mediaId: string, positionSeconds: number, durationSeconds: number, seriesId?: string) =>
    postJSON<WatchProgress>(`/api/progress/${encodeURIComponent(mediaType)}/${encodeURIComponent(mediaId)}`, { positionSeconds, durationSeconds, ...(seriesId ? { seriesId } : {}) }),
  scanLibrary: (types?: string[]) => postJSON<{ results: Array<{ library: string; success: boolean; message: string }> }>('/api/library/scan', { types }),
  setFlags: (mediaType: string, mediaId: string, patch: { favorite?: boolean; watched?: boolean }) =>
    postJSON<{ favorite: boolean; watched: boolean }>(`/api/me/flags/${encodeURIComponent(mediaType)}/${encodeURIComponent(mediaId)}`, patch),
  clearProgress: (mediaType: string, mediaId: string) => {
    const res = fetch(`/api/progress/${encodeURIComponent(mediaType)}/${encodeURIComponent(mediaId)}`, { method: 'DELETE' });
    return { cleared: true, res };
  },
  libraryProgress: (mediaType: string) => getJSON<{ mediaType: string; progress: Record<string, WatchProgress> }>(`/api/progress/library/${encodeURIComponent(mediaType)}`),
  deleteMovie: (id: string, deleteFiles = false) => {
    const res = fetch(`/api/movies/${encodeURIComponent(id)}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
    return res.then(async r => {
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? `Could not remove movie (${r.status})`);
      }
      return r.json() as Promise<{ success: boolean; id: string; deleteFiles: boolean; message: string }>;
    });
  },
  deleteSeries: (id: string, deleteFiles = false) => {
    const res = fetch(`/api/series/${encodeURIComponent(id)}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
    return res.then(async r => {
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? `Could not remove series (${r.status})`);
      }
      return r.json() as Promise<{ success: boolean; id: string; deleteFiles: boolean; message: string }>;
    });
  },
  deleteArtist: (id: string, deleteFiles = false) => {
    const res = fetch(`/api/artists/${encodeURIComponent(id)}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
    return res.then(async r => {
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? `Could not remove artist (${r.status})`);
      }
      return r.json() as Promise<{ success: boolean; id: string; deleteFiles: boolean; message: string }>;
    });
  },
  serverSettings: () => getJSON<ServerSettings>('/api/server-settings'),
  saveServerSettings: (body: Partial<ServerSettings> & { confirm?: string }) =>
    postJSON<ServerSettings>('/api/server-settings', body),
  testOutboundProxy: () => getJSON<{ ok: boolean; detail: string; latencyMs?: number }>('/api/server-settings/proxy-test'),
  health: () => getJSON<{ status: string; version: string }>('/api/health'),
  removeRequest: (id: string) => {
    const res = fetch(`/api/requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.then(async r => {
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? `Could not remove request (${r.status})`);
      }
      return r.json() as Promise<{ removed: boolean; id: string }>;
    });
  },
  stopRequest: (id: string) => postJSON<RequestItem & { stopped: boolean }>(`/api/requests/${encodeURIComponent(id)}/stop`)
};

export interface ActivityEvent {
  id: string;
  timestamp: string;
  service: string;
  type: string;
  status: string;
  humanReadable: string;
  technicalDetails?: Record<string, unknown>;
}

export interface AiActionRecord {
  timestamp: string;
  tool: string;
  arguments: Record<string, unknown>;
  success: boolean;
  requiredConfirmation: boolean;
  message: string;
}

export interface ThemeSummary {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  categories?: string[];
  active: boolean;
  installedAt?: string;
  mode: 'dark' | 'light';
  custom: boolean;
  cssVars: Record<string, string>;
}

export interface ThemeDetail {
  manifest: { id: string; name: string; description: string; author: string; version: string; categories?: string[] };
  cssVars: Record<string, string>;
  mode: 'dark' | 'light';
  id?: string;
}
