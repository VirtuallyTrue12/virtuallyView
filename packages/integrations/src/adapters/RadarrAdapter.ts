import { IntegrationAdapter } from '../adapter-interface.js';
import { Media, MediaStatus, Download } from '@virtuallyview/types';
import { queueProblem, joinApiUrl, lookupRequestCandidates, selectRequestCandidate, resolveAddTargets, listQualityProfiles, changeQualityProfile, currentQualityProfileId, type QualityProfile, type RequestSelectionInput, type RequestAddResult } from '../request-identity.js';

const ART = 'https://image.tmdb.org/t/p/w500';
const ART_LARGE = 'https://image.tmdb.org/t/p/w1280';

export interface ReleaseInfo { status?: string | undefined; inCinemas?: string | undefined; digitalRelease?: string | undefined; physicalRelease?: string | undefined }

/** "1:26:03" to seconds. */
function clockToSeconds(clock: string | undefined): number | undefined {
  const parts = clock?.split(':').map(Number);
  if (!parts || parts.length < 2 || parts.some(n => !Number.isFinite(n))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export class RadarrAdapter implements IntegrationAdapter<{ url: string; apiKey: string }> {
  id = 'radarr';
  name = 'Radarr';
  private config: { url: string; apiKey: string } | null = null;

  async connect(config: { url: string; apiKey: string }) {
    this.config = config;
    return { connected: true, message: 'Connected to Radarr' };
  }

  async disconnect() {
    this.config = null;
  }

  async healthCheck() {
    if (!this.config) return { healthy: false, status: 'offline' };
    try {
      const res = await fetch(`${this.config.url}/api/v3/system/status`, {
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
      name: 'Radarr',
      adapter: 'radarr',
      enabled: true,
      healthStatus: health.status,
      url: this.config?.url ?? 'http://localhost:7878',
      lastSync: new Date()
    };
  }

  private requireConfig(): { url: string; apiKey: string } {
    if (!this.config) throw new Error('Radarr is not connected. Add its URL and API key in Settings.');
    return this.config;
  }

  private async fetchRemote(query: string): Promise<Media[]> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v3/movie`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Radarr returned ${res.status} while listing movies.`);

    const data = (await res.json()) as Array<{
      id?: number;
      title?: string;
      originalTitle?: string;
      year?: number;
      tmdbId?: number;
      imdbId?: string;
      overview?: string;
      runtime?: number;
      ratings?: { value?: number };
      genres?: string[];
      hasFile?: boolean;
      images?: Array<{ coverType: string; url: string; remoteUrl?: string }>;
      studio?: string;
      certification?: string;
      collection?: { title?: string };
      inCinemas?: string;
      digitalRelease?: string;
      physicalRelease?: string;
      movieFile?: { id?: number; path?: string; size?: number; sceneName?: string; quality?: { quality?: { name?: string } }; mediaInfo?: { runTime?: string } };
      added?: string;
    }>;

    const q = query.trim().toLowerCase();
    return data
      .filter(m => m.title)
      .filter(m => (q ? m.title?.toLowerCase().includes(q) : true))
      .map(m => {
        const images = m.images ?? [];
        const posterImage = images.find(i => i.coverType === 'poster');
        const backdropImage = images.find(i => i.coverType === 'fanart');
        const posterRaw = posterImage?.remoteUrl ?? posterImage?.url ?? '';
        const backdropRaw = backdropImage?.remoteUrl ?? backdropImage?.url ?? '';
        const baseUrl = url.replace(/\/api\/v3\/?$/, '').replace(/radarr:\d+/, 'localhost:7878').replace(/sonarr:\d+/, 'localhost:8989').replace(/prowlarr:\d+/, 'localhost:9696').replace(/lidarr:\d+/, 'localhost:8686');
        const poster = posterRaw.startsWith('http') ? posterRaw : posterRaw ? `${baseUrl}${posterRaw}` : '';
        const backdrop = backdropRaw.startsWith('http') ? backdropRaw : backdropRaw ? `${baseUrl}${backdropRaw}` : '';
        const hasFile = !!m.hasFile;
        return {
          id: `radarr-${m.id}`,
          title: m.title as string,
          originalTitle: m.originalTitle,
          type: 'movie' as const,
          year: m.year,
          status: (hasFile ? 'available' : 'missing') as MediaStatus,
          quality: m.movieFile?.quality?.quality?.name,
          provider: { name: 'Radarr', id: m.id as number, metadata: { tmdbId: m.tmdbId, imdbId: m.imdbId } },
          artwork: { poster, backdrop },
          genres: m.genres ?? [],
          rating: m.ratings?.value,
          overview: m.overview,
          fileInfo: m.movieFile ? {
            path: m.movieFile.path, size: m.movieFile.size,
            releaseName: m.movieFile.sceneName, runtimeSeconds: clockToSeconds(m.movieFile.mediaInfo?.runTime)
          } : undefined,
          release: { inCinemas: m.inCinemas, digitalRelease: m.digitalRelease, physicalRelease: m.physicalRelease },
          studio: m.studio,
          certification: m.certification,
          collection: m.collection?.title,
          runtime: m.runtime,
          createdAt: m.added ? new Date(m.added) : new Date(),
          updatedAt: m.added ? new Date(m.added) : new Date()
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
    try {
      if (this.config?.apiKey) {
        const all = await this.fetchRemote('');
        const found = all.find(m => m.id === id);
        if (found) return found;
      }
    } catch {
      // adapter disconnected: no fallback
    }
    return null;
  }

  async lookupCandidates(title: string) {
    return lookupRequestCandidates(this.requireConfig(), 'radarr', title);
  }

  async resolveCandidate(req: RequestSelectionInput) {
    return selectRequestCandidate(await this.lookupCandidates(req.title), req);
  }

  async add(req: RequestSelectionInput): Promise<RequestAddResult> {
    const { url, apiKey } = this.requireConfig();
    const selection = await this.resolveCandidate(req).catch(error => ({ failure: {
      success: false, message: error instanceof Error ? error.message : 'Radarr metadata lookup failed.'
    } }));
    if ('failure' in selection) return selection.failure;
    const match = selection.candidate;

    // Never guess profile IDs or folder paths: ask the connected Radarr what
    // it actually has, using the request's preferred profile name when given.
    const targets = await resolveAddTargets({ url, apiKey }, 'radarr', req.qualityProfile, req.qualityStrict)
      .catch(error => ({ failure: {
        success: false, message: error instanceof Error ? error.message : 'Radarr could not read its add settings.'
      } }));
    if ('failure' in targets) return targets.failure;

    const addRes = await fetch(`${url}/api/v3/movie`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tmdbId: Number(match.providerId),
        title: match.title,
        qualityProfileId: targets.qualityProfileId,
        rootFolderPath: targets.rootFolderPath,
        monitored: true,
        ...(req.wait ? { minimumAvailability: 'released' } : {}),
        addOptions: { searchForMovie: !req.wait }
      }),
      signal: AbortSignal.timeout(4000)
    });
    if (!addRes.ok) {
      const body = await addRes.text().catch(() => '');
      return { success: false, message: `Radarr rejected the add request (status ${addRes.status}). ${body}`.trim() };
    }
    const json = (addRes as unknown as { json?: () => Promise<unknown> }).json;
    const added = typeof json === 'function' ? await json.call(addRes) as { id?: number } : {};
    return {
      success: true, mediaId: added.id ? `radarr-${added.id}` : undefined,
      qualityProfile: targets.qualityProfileName, rootFolder: targets.rootFolderPath,
      message: `Queued "${match.title}" in Radarr`
    };
  }

  /** Release dates for a TMDB id, so a request can warn when only camera copies exist. */
  async releaseInfo(tmdbId: string): Promise<ReleaseInfo | null> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(joinApiUrl(url, `/api/v3/movie/lookup/tmdb`) + `?tmdbId=${encodeURIComponent(tmdbId)}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const row = (await res.json()) as { status?: string; inCinemas?: string; digitalRelease?: string; physicalRelease?: string };
    return { status: row.status, inCinemas: row.inCinemas, digitalRelease: row.digitalRelease, physicalRelease: row.physicalRelease };
  }

  /**
   * The imported file is wrong (mislabeled release, wrong film): mark the grab
   * as failed so that release is never picked again, delete the file, and
   * search for another.
   */
  async replaceFile(mediaId: string): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const numeric = Number(mediaId.startsWith('radarr-') ? mediaId.slice(7) : mediaId);
    if (!Number.isInteger(numeric)) return { success: false, message: 'Unknown title id.' };
    const headers = { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' };
    const movieRes = await fetch(`${url}/api/v3/movie/${numeric}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!movieRes.ok) return { success: false, message: `Radarr could not read that movie (status ${movieRes.status}).` };
    const movie = (await movieRes.json()) as { movieFile?: { id?: number } };
    const history = await fetch(`${url}/api/v3/history/movie?movieId=${numeric}`, { headers, signal: AbortSignal.timeout(8000) });
    if (history.ok) {
      const events = (await history.json()) as Array<{ id?: number; eventType?: string; date?: string }>;
      const grab = events.filter(e => e.eventType === 'grabbed').sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      if (grab?.id) await fetch(`${url}/api/v3/history/failed/${grab.id}`, { method: 'POST', headers, signal: AbortSignal.timeout(8000) }).catch(() => undefined);
    }
    if (movie.movieFile?.id) {
      await fetch(`${url}/api/v3/moviefile/${movie.movieFile.id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) }).catch(() => undefined);
    }
    const search = await fetch(`${url}/api/v3/command`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'MoviesSearch', movieIds: [numeric] }), signal: AbortSignal.timeout(8000)
    });
    if (!search.ok) return { success: false, message: `The file was removed, but Radarr could not start a new search (status ${search.status}).` };
    return { success: true, message: 'The bad file was removed and a new search started.' };
  }

  async remove(mediaId: string, deleteFiles = false): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const numericId = mediaId.startsWith('radarr-') ? mediaId.slice('radarr-'.length) : mediaId;
    const res = await fetch(`${url}/api/v3/movie/${numericId}?deleteFiles=${deleteFiles}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) {
      return { success: false, message: `Radarr could not remove the movie (status ${res.status}).` };
    }
    return { success: true, message: 'Removed from Radarr.' };
  }

  async getQueue(): Promise<Download[]> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v3/queue?pageSize=100`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Radarr returned ${res.status} while listing the queue.`);
    const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
    return (body.records ?? []).map(q => {
      const total = (Number(q.size) || 0) as number;
      const left = (Number(q.sizeleft ?? total) || 0) as number;
      const progress = total > 0
        ? Math.max(0, Math.min(100, Math.round(((total - left) / total) * 100)))
        : 0;
      return {
        id: `queue-${String(q.id ?? '')}`,
        sourceClient: 'radarr',
        downloadId: typeof q.downloadId === 'string' ? q.downloadId : undefined,
        mediaId: q.movieId ? `radarr-${String(q.movieId)}` : undefined,
        status: queueProblem(q).status ?? String((q.status ?? '') as string).toLowerCase(),
        ...(queueProblem(q).message ? { statusMessage: queueProblem(q).message } : {}),
        progress,
        title: (q.title as string) ?? 'Unknown download',
        size: total > 0 ? total : undefined,
        timeleft: (q.timeleft as string) ?? undefined
      } as Download & { title?: string; timeleft?: string };
    }) as Download[];
  }

  async removeQueueItem(queueId: string, blocklist = false): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v3/queue/${queueId}?removeFromClient=true&blocklist=${blocklist}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return { success: false, message: `Radarr could not remove that queue item (status ${res.status}).` };
    return { success: true, message: 'Removed from the queue.' };
  }

  /** Rescan disk for new/changed files and refresh metadata ("Scan library"). */
  async scanLibrary(): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    for (const command of ['RescanMovie', 'RefreshMovie']) {
      const res = await fetch(`${url}/api/v3/command`, {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: command }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return { success: false, message: `Radarr rejected the scan (status ${res.status}).` };
    }
    return { success: true, message: 'Radarr is scanning for new files.' };
  }

  async listQualityProfiles(): Promise<QualityProfile[]> {
    return listQualityProfiles(this.requireConfig(), 'radarr');
  }

  async getQualityProfileId(mediaId: string): Promise<number | null> {
    const numeric = Number(mediaId.startsWith('radarr-') ? mediaId.slice(7) : mediaId);
    return Number.isInteger(numeric) ? currentQualityProfileId(this.requireConfig(), 'radarr', numeric) : null;
  }

  /** Change a title's quality profile, optionally searching for that quality now. */
  async setQualityProfile(mediaId: string, profileId: number, search: boolean): Promise<{ success: boolean; message: string }> {
    const numeric = Number(mediaId.startsWith('radarr-') ? mediaId.slice(7) : mediaId);
    if (!Number.isInteger(numeric)) return { success: false, message: 'Unknown title id.' };
    return changeQualityProfile(this.requireConfig(), 'radarr', numeric, profileId, search);
  }

  async refreshMetadata(mediaId: string): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const numericId = mediaId.startsWith('radarr-') ? mediaId.slice('radarr-'.length) : mediaId;
    const res = await fetch(`${url}/api/v3/command`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MoviesSearch', movieIds: [Number(numericId)] }),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return { success: false, message: `Radarr could not search for that movie (status ${res.status}).` };
    return { success: true, message: 'Radarr search started.' };
  }

  async getHistory(): Promise<{ events: { timestamp: Date; service: string; message: string }[] }> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v3/history?pageSize=50`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Radarr returned ${res.status} while listing history.`);
    const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
    return {
      events: (body.records ?? []).map(r => ({
        timestamp: r.date ? new Date(r.date as string) : new Date(),
        service: 'radarr',
        message: `${(r.eventType as string) ?? 'event'}: ${(r.sourceTitle as string) ?? ''}`.trim()
      }))
    };
  }
}
