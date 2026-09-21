import { IntegrationAdapter } from '../adapter-interface.js';
import { Media, MediaStatus, Download } from '@virtuallyview/types';
import { artProxyUrl } from '../art-proxy.js';
import { runArrCommand, queueProblem, lookupRequestCandidates, selectRequestCandidate, resolveAddTargets, listQualityProfiles, changeQualityProfile, currentQualityProfileId, type QualityProfile, type RequestSelectionInput, type RequestAddResult } from '../request-identity.js';

export interface LidarrAlbum {
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

export interface LidarrTrack {
  id: number;
  title: string;
  albumId: number;
  trackNumber?: string;
  durationMs?: number;
  hasFile: boolean;
  trackFileId?: number;
  path?: string;
  size?: number;
  quality?: string;
  /** 1 is mono, 2 is stereo. */
  channels?: number;
  /** Such as "FLAC 16-bit 44.1kHz stereo". */
  audioLabel?: string;
}

/** Channels, bit depth and sample rate from a track file's media info. */
function audioDetails(info: unknown): { channels?: number; audioLabel?: string } {
  if (!info || typeof info !== 'object') return {};
  const m = info as { audioChannels?: number; audioBits?: string; audioSampleRate?: string; audioCodec?: string };
  const channels = typeof m.audioChannels === 'number' ? m.audioChannels : undefined;
  const label = [m.audioCodec, m.audioBits?.replace('bit', '-bit'), m.audioSampleRate, channels === 1 ? 'mono' : channels === 2 ? 'stereo' : channels ? `${channels}ch` : '']
    .filter(Boolean).join(' ');
  return { ...(channels !== undefined ? { channels } : {}), ...(label ? { audioLabel: label } : {}) };
}

export class LidarrAdapter implements IntegrationAdapter<{ url: string; apiKey: string }> {
  id = 'lidarr';
  name = 'Lidarr';
  private config: { url: string; apiKey: string } | null = null;

  async connect(config: { url: string; apiKey: string }) {
    this.config = config;
    return { connected: true, message: 'Connected to Lidarr' };
  }

  async disconnect() {
    this.config = null;
  }

  async healthCheck() {
    if (!this.config) return { healthy: false, status: 'offline' };
    try {
      const res = await fetch(`${this.config.url}/api/v1/system/status`, {
        headers: { 'X-Api-Key': this.config.apiKey },
        signal: AbortSignal.timeout(2500)
      });
      return { healthy: res.ok, status: res.ok ? 'online' : 'offline' };
    } catch {
      return { healthy: false, status: 'offline' };
    }
  }

  async getStatus() {
    const health = await this.healthCheck();
    return {
      name: 'Lidarr',
      adapter: 'lidarr',
      enabled: true,
      healthStatus: health.status,
      url: this.config?.url ?? 'http://localhost:8686',
      lastSync: new Date()
    };
  }

  private requireConfig(): { url: string; apiKey: string } {
    if (!this.config) throw new Error('Lidarr is not connected. Add its URL and API key in Settings.');
    return this.config;
  }

  private artistCache: { at: number; items: Media[] } | null = null;

  /**
   * The artist list backs every artist/album page. Refetching it (4s timeout)
   * on each navigation made rapid album -> artist -> album browsing fail
   * whenever Lidarr was briefly slow, so a fresh copy is reused for 20s and a
   * stale one still serves when Lidarr errors.
   */
  private async fetchRemote(query: string): Promise<Media[]> {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    if (!this.artistCache || now - this.artistCache.at > 20_000) {
      try {
        this.artistCache = { at: now, items: await this.fetchArtistList() };
      } catch (error) {
        if (!this.artistCache || now - this.artistCache.at > 5 * 60_000) throw error;
      }
    }
    const items = this.artistCache!.items;
    return q ? items.filter(a => a.title.toLowerCase().includes(q)) : items;
  }

  private async fetchArtistList(): Promise<Media[]> {
    const query = '';
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/artist`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Lidarr returned ${res.status} while listing artists.`);

    const data = (await res.json()) as Array<{
      id?: number;
      artistName?: string;
      foreignArtistId?: string;
      overview?: string;
      genres?: string[];
      ratings?: { value?: number };
      images?: Array<{ coverType: string; url: string; remoteUrl?: string }>;
      statistics?: { trackFileCount?: number; albumCount?: number; totalTrackCount?: number; sizeOnDisk?: number };
      added?: string;
    }>;

    const q = query.trim().toLowerCase();
    return data
      .filter(a => a.artistName)
      .filter(a => (q ? a.artistName?.toLowerCase().includes(q) : true))
      .map(a => {
        const images = a.images ?? [];
        const pick = (type: string) => { const i = images.find(x => x.coverType === type); return artProxyUrl(i?.url ?? i?.remoteUrl); };
        const poster = pick('poster');
        const backdrop = pick('fanart');
        const trackFiles = a.statistics?.trackFileCount ?? 0;
        return {
          id: `lidarr-${a.id}`,
          title: a.artistName as string,
          type: 'artist' as const,
          status: (trackFiles > 0 ? 'available' : 'missing') as MediaStatus,
          provider: { name: 'Lidarr', id: a.id as number, metadata: { foreignArtistId: a.foreignArtistId } },
          artwork: { poster, backdrop },
          genres: a.genres ?? [],
          rating: a.ratings?.value,
          overview: a.overview,
          albumCount: a.statistics?.albumCount ?? 0,
          trackFileCount: trackFiles,
          totalTrackCount: a.statistics?.totalTrackCount ?? 0,
          sizeOnDisk: a.statistics?.sizeOnDisk ?? 0,
          createdAt: a.added ? new Date(a.added) : new Date(),
          updatedAt: a.added ? new Date(a.added) : new Date()
        };
      }) as unknown as Media[];
  }

  async search(query: string): Promise<Media[]> {
    return this.fetchRemote(query);
  }

  async getItems(): Promise<Media[]> {
    return this.fetchRemote('');
  }

  async getItem(id: string): Promise<Media | null> {
    const all = await this.fetchRemote('');
    return all.find(a => a.id === id) ?? null;
  }

  async lookupCandidates(title: string) {
    return lookupRequestCandidates(this.requireConfig(), 'lidarr', title);
  }

  async resolveCandidate(req: RequestSelectionInput) {
    return selectRequestCandidate(await this.lookupCandidates(req.title), req);
  }

  async add(req: RequestSelectionInput): Promise<RequestAddResult> {
    this.artistCache = null;
    const { url, apiKey } = this.requireConfig();
    const selection = await this.resolveCandidate(req).catch(error => ({ failure: {
      success: false, message: error instanceof Error ? error.message : 'Lidarr metadata lookup failed.'
    } }));
    if ('failure' in selection) return selection.failure;
    const match = selection.candidate;

    // Read the real quality/profile metadata + root folder from the connected
    // Lidarr instead of hardcoding IDs/paths that may not exist on this box.
    const targets = await resolveAddTargets({ url, apiKey }, 'lidarr', req.qualityProfile, req.qualityStrict)
      .catch(error => ({ failure: {
        success: false, message: error instanceof Error ? error.message : 'Lidarr could not read its add settings.'
      } }));
    if ('failure' in targets) return targets.failure;

    const addRes = await fetch(`${url}/api/v1/artist`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        foreignArtistId: match.providerId,
        artistName: match.title,
        qualityProfileId: targets.qualityProfileId,
        ...(targets.metadataProfileId !== undefined ? { metadataProfileId: targets.metadataProfileId } : {}),
        rootFolderPath: targets.rootFolderPath,
        monitored: true,
        addOptions: { monitor: 'all', searchForMissingAlbums: true }
      }),
      signal: AbortSignal.timeout(4000)
    });
    if (!addRes.ok) {
      const body = await addRes.text().catch(() => '');
      return { success: false, message: `Lidarr rejected the add request (status ${addRes.status}). ${body}`.trim() };
    }
    const json = (addRes as unknown as { json?: () => Promise<unknown> }).json;
    const added = typeof json === 'function' ? await json.call(addRes) as { id?: number } : {};
    return {
      success: true, mediaId: added.id ? `lidarr-${added.id}` : undefined,
      qualityProfile: targets.qualityProfileName, rootFolder: targets.rootFolderPath,
      message: `Queued "${match.title}" in Lidarr`
    };
  }

  async remove(mediaId: string, deleteFiles = false): Promise<{ success: boolean; message: string }> {
    this.artistCache = null;
    const { url, apiKey } = this.requireConfig();
    const numericId = mediaId.startsWith('lidarr-') ? mediaId.slice('lidarr-'.length) : mediaId;
    const res = await fetch(`${url}/api/v1/artist/${numericId}?deleteFiles=${deleteFiles}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) {
      return { success: false, message: `Lidarr could not remove the artist (status ${res.status}).` };
    }
    return { success: true, message: 'Removed from Lidarr.' };
  }

  async getQueue(): Promise<Download[]> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/queue?pageSize=100`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Lidarr returned ${res.status} while listing the queue.`);
    const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
    return (body.records ?? []).map(q => {
      const total = (Number(q.size) || 0) as number;
      const left = (Number(q.sizeleft ?? total) || 0) as number;
      const progress = total > 0
        ? Math.max(0, Math.min(100, Math.round(((total - left) / total) * 100)))
        : 0;
      return {
        id: `queue-${String(q.id ?? '')}`,
        sourceClient: 'lidarr',
        downloadId: typeof q.downloadId === 'string' ? q.downloadId : undefined,
        mediaId: q.artistId ? `lidarr-${String(q.artistId)}` : undefined,
        status: queueProblem(q).status ?? String((q.status ?? '') as string).toLowerCase(),
        ...(queueProblem(q).message ? { statusMessage: queueProblem(q).message } : {}),
        progress,
        title: (q.title as string) ?? 'Unknown download',
        size: total > 0 ? total : undefined,
        timeleft: (q.timeleft as string) ?? undefined
      } as Download & { title?: string; timeleft?: string };
    }) as Download[];
  }

  /**
   * Albums for one artist. Album ids are numeric Lidarr ids (the artist page
   * links artistId -> albums -> tracks, all via the same API).
   */
  async removeQueueItem(queueId: string, blocklist = false): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/queue/${queueId}?removeFromClient=true&blocklist=${blocklist}`, {
      method: 'DELETE', headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return { success: false, message: `Lidarr could not remove that queue item (status ${res.status}).` };
    return { success: true, message: 'Removed from the queue.' };
  }

  /** A cover image stored by Lidarr itself, fetched for the artwork proxy. */
  async fetchMediaCover(path: string): Promise<Response> {
    const { url, apiKey } = this.requireConfig();
    return fetch(`${url.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '')}${path}`, { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(8000) });
  }

  /** Search for every monitored album of an artist that is missing tracks. */
  async searchMissing(artistId: string | number): Promise<{ success: boolean; message: string; count: number }> {
    const numeric = String(artistId).replace(/^lidarr-/, '');
    const url = this.requireConfig().url;
    const res = await fetch(`${url}/api/v1/album?artistId=${encodeURIComponent(numeric)}`, { headers: { 'X-Api-Key': this.requireConfig().apiKey }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { success: false, message: `Lidarr returned ${res.status} while listing albums.`, count: 0 };
    const albums = (await res.json()) as Array<{ id?: number; monitored?: boolean; statistics?: { trackFileCount?: number; trackCount?: number } }>;
    const wanted = albums.filter(a => a.monitored !== false && (a.statistics?.trackFileCount ?? 0) < (a.statistics?.trackCount ?? 1)).map(a => a.id).filter((n): n is number => typeof n === 'number');
    if (!wanted.length) return { success: true, message: 'Nothing is missing.', count: 0 };
    const result = await runArrCommand(this.requireConfig(), 'v1', { name: 'AlbumSearch', albumIds: wanted }, `a search for ${wanted.length} ${wanted.length === 1 ? 'album' : 'albums'}`);
    return { ...result, count: wanted.length };
  }

  /** Ask Lidarr to look for an album's missing tracks. */
  async searchAlbum(albumId: number): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/command`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'AlbumSearch', albumIds: [albumId] }),
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return { success: false, message: `Lidarr could not start the search (status ${res.status}).` };
    return { success: true, message: 'Search started. New downloads appear on the Downloads page.' };
  }

  async getAlbums(artistId: string | number): Promise<LidarrAlbum[]> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/album?artistId=${encodeURIComponent(String(artistId))}&pageSize=200`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) throw new Error(`Lidarr returned ${res.status} while listing albums.`);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    return body.map(album => {
      const images = (album.images as Array<{ coverType?: string; url?: string; remoteUrl?: string }>) ?? [];
      const cover = images.find(i => i.coverType === 'cover') ?? images[0];
      const raw = cover?.remoteUrl ?? cover?.url ?? '';
      const rating = typeof album.ratings === 'object' && album.ratings !== null
        ? { votes: Number((album.ratings as { votes?: number }).votes) || 0, value: Number((album.ratings as { value?: number }).value) || 0 }
        : undefined;
      return {
        id: Number(album.id),
        title: String(album.title ?? 'Unknown album'),
        artistId: Number(album.artistId),
        albumType: String(album.albumType ?? 'Album'),
        ...(album.releaseDate ? { releaseDate: String(album.releaseDate) } : {}),
        duration: Number(album.duration) || 0,
        mediumCount: Number(album.mediumCount) || 0,
        ...(rating ? { ratings: rating } : {}),
        ...(raw ? { artwork: { cover: artProxyUrl(raw) } } : {})
      };
    });
  }

  /** Track list (with file info) for one artist. */
  async getTracks(artistId: string | number): Promise<LidarrTrack[]> {
    const { url, apiKey } = this.requireConfig();
    const [tracksRes, filesRes] = await Promise.all([
      fetch(`${url}/api/v1/track?artistId=${encodeURIComponent(String(artistId))}&pageSize=1000`, {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(8000)
      }),
      fetch(`${url}/api/v1/trackfile?artistId=${encodeURIComponent(String(artistId))}`, {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(8000)
      })
    ]);
    if (!tracksRes.ok) throw new Error(`Lidarr returned ${tracksRes.status} while listing tracks.`);
    const tracks = (await tracksRes.json()) as Array<Record<string, unknown>>;
    const files = filesRes.ok
      ? Object.fromEntries(((await filesRes.json()) as Array<Record<string, unknown>>).map(f => [Number(f.id), f]))
      : {};
    return tracks.map(t => {
      const file = files[Number(t.trackFileId)] as Record<string, unknown> | undefined;
      const filePath = file?.path ? String(file.path) : undefined;
      const trackFileId = t.trackFileId !== null && t.trackFileId !== undefined ? Number(t.trackFileId) : undefined;
      return {
        id: Number(t.id),
        title: String(t.title ?? 'Track'),
        albumId: Number(t.albumId),
        ...(t.trackNumber !== undefined ? { trackNumber: String(t.trackNumber) } : {}),
        durationMs: Number(t.duration) || 0,
        hasFile: Boolean(t.hasFile ?? filePath),
        ...(trackFileId ? { trackFileId } : {}),
        ...(filePath ? { path: filePath } : {}),
        ...(file?.size ? { size: Number(file.size) } : {}),
        ...audioDetails(file?.mediaInfo),
        ...(file?.quality && typeof file.quality === 'object'
          ? { quality: String((file.quality as { quality?: { name?: string } }).quality?.name ?? '') }
          : {})
      };
    });
  }

  /** A single album, including its artist name for display. */
  async getAlbum(albumId: string | number): Promise<(LidarrAlbum & { artistTitle?: string }) | null> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/album/${encodeURIComponent(String(albumId))}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const album = (await res.json()) as Record<string, unknown>;
    let artistTitle: string | undefined;
    if (album.artistId) {
      const artistRes = await fetch(`${url}/api/v1/artist/${encodeURIComponent(String(album.artistId))}`, {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(4000)
      });
      if (artistRes.ok) {
        const artist = (await artistRes.json()) as { artistName?: string };
        artistTitle = artist.artistName;
      }
    }
    const images = (album.images as Array<{ coverType?: string; url?: string; remoteUrl?: string }>) ?? [];
    const cover = images.find(i => i.coverType === 'cover') ?? images[0];
    const raw = cover?.remoteUrl ?? cover?.url ?? '';
    return {
      id: Number(album.id),
      title: String(album.title ?? 'Unknown album'),
      artistId: Number(album.artistId),
      ...(album.albumType ? { albumType: String(album.albumType) } : {}),
      ...(album.releaseDate ? { releaseDate: String(album.releaseDate) } : {}),
      duration: Number(album.duration) || 0,
      mediumCount: Number(album.mediumCount) || 0,
      ...(raw ? { artwork: { cover: artProxyUrl(raw) } } : {}),
      ...(artistTitle ? { artistTitle } : {})
    };
  }

  /** Track list for one album (with file info for playback). */
  async getAlbumTracks(albumId: string | number): Promise<LidarrTrack[]> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/track?albumId=${encodeURIComponent(String(albumId))}&pageSize=500`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`Lidarr returned ${res.status} while listing album tracks.`);
    const tracks = (await res.json()) as Array<Record<string, unknown>>;
    const trackFileIds = [...new Set(tracks.map(t => Number(t.trackFileId)).filter(id => Number.isFinite(id) && id > 0))];
    let files: Record<number, Record<string, unknown>> = {};
    if (trackFileIds.length) {
      try {
        const filesRes = await fetch(`${url}/api/v1/trackfile?trackFileIds=${trackFileIds.join(',')}`, {
          headers: { 'X-Api-Key': apiKey },
          signal: AbortSignal.timeout(8000)
        });
        if (filesRes.ok) {
          files = Object.fromEntries(((await filesRes.json()) as Array<Record<string, unknown>>).map(f => [Number(f.id), f]));
        }
      } catch {
        files = {};
      }
    }
    return tracks.map(t => {
      const file = files[Number(t.trackFileId)] as Record<string, unknown> | undefined;
      const filePath = file?.path ? String(file.path) : undefined;
      const trackFileId = t.trackFileId !== null && t.trackFileId !== undefined ? Number(t.trackFileId) : undefined;
      return {
        id: Number(t.id),
        title: String(t.title ?? 'Track'),
        albumId: Number(t.albumId),
        ...(t.trackNumber !== undefined ? { trackNumber: String(t.trackNumber) } : {}),
        durationMs: Number(t.duration) || 0,
        hasFile: Boolean(t.hasFile ?? filePath),
        ...(trackFileId ? { trackFileId } : {}),
        ...(filePath ? { path: filePath } : {}),
        ...(file?.size ? { size: Number(file.size) } : {}),
        ...(file?.quality && typeof file.quality === 'object'
          ? { quality: String((file.quality as { quality?: { name?: string } }).quality?.name ?? '') }
          : {})
      };
    });
  }

  /** A single track's file path, used by the music stream route to stay within media roots. */
  async getTrackFile(trackId: string | number): Promise<{ path: string; size?: number } | null> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/track/${encodeURIComponent(String(trackId))}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const track = (await res.json()) as Record<string, unknown>;
    if (!track || !track.trackFileId) return null;
    const fileRes = await fetch(`${url}/api/v1/trackfile/${encodeURIComponent(String(track.trackFileId))}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!fileRes.ok) return null;
    const file = (await fileRes.json()) as { path?: string; size?: number };
    return file.path ? { path: file.path, ...(file.size ? { size: file.size } : {}) } : null;
  }

  /** Rescan disk for new/changed files and refresh metadata ("Scan library"). */
  async scanLibrary(): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    for (const command of ['RescanFolders', 'RefreshArtist']) {
      const res = await fetch(`${url}/api/v1/command`, {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: command }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return { success: false, message: `Lidarr rejected the scan (status ${res.status}).` };
    }
    return { success: true, message: 'Lidarr is scanning for new files.' };
  }

  async listQualityProfiles(): Promise<QualityProfile[]> {
    return listQualityProfiles(this.requireConfig(), 'lidarr');
  }

  async getQualityProfileId(mediaId: string): Promise<number | null> {
    const numeric = Number(mediaId.startsWith('lidarr-') ? mediaId.slice(7) : mediaId);
    return Number.isInteger(numeric) ? currentQualityProfileId(this.requireConfig(), 'lidarr', numeric) : null;
  }

  /** Change a title's quality profile, optionally searching for that quality now. */
  async setQualityProfile(mediaId: string, profileId: number, search: boolean): Promise<{ success: boolean; message: string }> {
    const numeric = Number(mediaId.startsWith('lidarr-') ? mediaId.slice(7) : mediaId);
    if (!Number.isInteger(numeric)) return { success: false, message: 'Unknown title id.' };
    return changeQualityProfile(this.requireConfig(), 'lidarr', numeric, profileId, search);
  }

  async refreshMetadata(mediaId: string): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const numericId = mediaId.startsWith('lidarr-') ? mediaId.slice('lidarr-'.length) : mediaId;
    const res = await fetch(`${url}/api/v1/command`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ArtistSearch', artistId: Number(numericId) }),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return { success: false, message: `Lidarr could not search for that artist (status ${res.status}).` };
    return { success: true, message: 'Lidarr search started.' };
  }

  async getHistory(): Promise<{ events: { timestamp: Date; service: string; message: string }[] }> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v1/history?pageSize=50`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Lidarr returned ${res.status} while listing history.`);
    const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
    return {
      events: (body.records ?? []).map(r => ({
        timestamp: r.date ? new Date(r.date as string) : new Date(),
        service: 'lidarr',
        message: `${(r.eventType as string) ?? 'event'}: ${(r.sourceTitle as string) ?? ''}`.trim()
      }))
    };
  }
}
