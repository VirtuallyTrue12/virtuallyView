import { IntegrationAdapter } from '../adapter-interface.js';
import { Media, MediaStatus, Download } from '@virtuallyview/types';
import { runArrCommand, queueProblem, lookupRequestCandidates, selectRequestCandidate, resolveAddTargets, listQualityProfiles, changeQualityProfile, currentQualityProfileId, type QualityProfile, type RequestSelectionInput, type RequestAddResult } from '../request-identity.js';

export interface SonarrEpisode {
  id: string;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate?: string;
  overview?: string;
  runtime?: number;
  hasFile: boolean;
  monitored?: boolean;
}

export class SonarrAdapter implements IntegrationAdapter<{ url: string; apiKey: string }> {
  id = 'sonarr';
  name = 'Sonarr';
  private config: { url: string; apiKey: string } | null = null;

  async connect(config: { url: string; apiKey: string }) {
    this.config = config;
    return { connected: true, message: 'Connected to Sonarr' };
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
      name: 'Sonarr',
      adapter: 'sonarr',
      enabled: true,
      healthStatus: health.status,
      url: this.config?.url ?? 'http://localhost:8989',
      lastSync: new Date()
    };
  }

  private requireConfig(): { url: string; apiKey: string } {
    if (!this.config) throw new Error('Sonarr is not connected. Add its URL and API key in Settings.');
    return this.config;
  }

  private async fetchRemote(query: string): Promise<Media[]> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v3/series`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Sonarr returned ${res.status} while listing series.`);

    const data = (await res.json()) as Array<{
      id?: number;
      title?: string;
      year?: number;
      tvdbId?: number;
      imdbId?: string;
      overview?: string;
      runtime?: number;
      ratings?: { value?: number };
      genres?: string[];
      network?: string;
      certification?: string;
      images?: Array<{ coverType: string; url: string; remoteUrl?: string }>;
      statistics?: { episodeFileCount?: number; seasonCount?: number };
      seasons?: Array<{ seasonNumber?: number; statistics?: { totalEpisodeCount?: number; episodeFileCount?: number } }>;
      added?: string;
    }>;

    const q = query.trim().toLowerCase();
    return data
      .filter(s => s.title)
      .filter(s => (q ? s.title?.toLowerCase().includes(q) : true))
      .map(s => {
        const images = s.images ?? [];
        const baseUrl = url.replace(/\/api\/v3\/?$/, '').replace(/sonarr:\d+/, 'localhost:8989');
        const imageUrl = (raw: string | undefined) =>
          raw?.startsWith('http') ? raw : raw ? `${baseUrl}${raw}` : '';
        const poster = imageUrl(images.find(i => i.coverType === 'poster')?.remoteUrl ?? images.find(i => i.coverType === 'poster')?.url);
        const backdrop = imageUrl(images.find(i => i.coverType === 'fanart')?.remoteUrl ?? images.find(i => i.coverType === 'fanart')?.url);
        const episodeFiles = s.statistics?.episodeFileCount ?? 0;
        return {
          id: `sonarr-${s.id}`,
          title: s.title as string,
          type: 'series' as const,
          year: s.year,
          status: (episodeFiles > 0 ? 'available' : 'missing') as MediaStatus,
          provider: { name: 'Sonarr', id: s.id as number, metadata: { tvdbId: s.tvdbId, imdbId: s.imdbId } },
          artwork: { poster, backdrop },
          genres: s.genres ?? [],
          rating: s.ratings?.value,
          overview: s.overview,
          studio: s.network,
          certification: s.certification,
          runtime: s.runtime,
          seasons: (s.seasons ?? [])
            .filter(season => typeof season.seasonNumber === 'number' && season.seasonNumber >= 0)
            .map(season => ({
              number: season.seasonNumber!,
              episodes: season.statistics?.totalEpisodeCount ?? 0,
              availableEpisodes: season.statistics?.episodeFileCount ?? 0
            })),
          seasonCount: s.statistics?.seasonCount,
          episodeFileCount: s.statistics?.episodeFileCount,
          createdAt: s.added ? new Date(s.added) : new Date(),
          updatedAt: s.added ? new Date(s.added) : new Date()
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
    return all.find(s => s.id === id) ?? null;
  }

  /**
   * Episodes for one series, including whether each has a file. The dashboard
   * streams TV at the episode level because a series has no single file path.
   */
  async getEpisodes(seriesId: string): Promise<SonarrEpisode[]> {
    const { url, apiKey } = this.requireConfig();
    const numeric = seriesId.startsWith('sonarr-') ? seriesId.slice('sonarr-'.length) : seriesId;
    const res = await fetch(`${url}/api/v3/episode?seriesId=${encodeURIComponent(numeric)}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Sonarr returned ${res.status} while listing episodes.`);
    const data = (await res.json()) as Array<{
      id?: number;
      seriesId?: number;
      seasonNumber?: number;
      episodeNumber?: number;
      title?: string;
      airDate?: string;
      overview?: string;
      runtime?: number;
      hasFile?: boolean;
      monitored?: boolean;
    }>;
    return data
      .filter(e => typeof e.seasonNumber === 'number' && typeof e.episodeNumber === 'number')
      .map(e => ({
        id: `episode-${e.id}`,
        seriesId: `sonarr-${e.seriesId ?? numeric}`,
        seasonNumber: e.seasonNumber as number,
        episodeNumber: e.episodeNumber as number,
        title: e.title ?? `Episode ${e.episodeNumber}`,
        airDate: e.airDate,
        overview: e.overview,
        runtime: e.runtime,
        hasFile: e.hasFile === true,
        monitored: e.monitored !== false
      }))
      .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  }

  /** Resolve the on-disk path for one episode via its episode file. */
  async getEpisodeFile(episodeId: string): Promise<{ path: string; size?: number } | null> {
    const { url, apiKey } = this.requireConfig();
    const numeric = episodeId.startsWith('episode-') ? episodeId.slice('episode-'.length) : episodeId;
    const epRes = await fetch(`${url}/api/v3/episode/${encodeURIComponent(numeric)}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!epRes.ok) return null;
    const ep = (await epRes.json()) as { episodeFileId?: number };
    if (!ep.episodeFileId) return null;
    const fileRes = await fetch(`${url}/api/v3/episodefile/${ep.episodeFileId}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!fileRes.ok) return null;
    const file = (await fileRes.json()) as { path?: string; size?: number };
    if (!file.path) return null;
    return { path: file.path, size: file.size };
  }

  async lookupCandidates(title: string) {
    return lookupRequestCandidates(this.requireConfig(), 'sonarr', title);
  }

  async resolveCandidate(req: RequestSelectionInput) {
    return selectRequestCandidate(await this.lookupCandidates(req.title), req);
  }

  async add(req: RequestSelectionInput): Promise<RequestAddResult> {
    const { url, apiKey } = this.requireConfig();
    const selection = await this.resolveCandidate(req).catch(error => ({ failure: {
      success: false, message: error instanceof Error ? error.message : 'Sonarr metadata lookup failed.'
    } }));
    if ('failure' in selection) return selection.failure;
    const match = selection.candidate;

    // Read the real quality profile + root folder from the connected Sonarr
    // instead of hardcoding IDs/paths that may not exist on this instance.
    const targets = await resolveAddTargets({ url, apiKey }, 'sonarr', req.qualityProfile, req.qualityStrict)
      .catch(error => ({ failure: {
        success: false, message: error instanceof Error ? error.message : 'Sonarr could not read its add settings.'
      } }));
    if ('failure' in targets) return targets.failure;

    const addRes = await fetch(`${url}/api/v3/series`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tvdbId: Number(match.providerId),
        title: match.title,
        qualityProfileId: targets.qualityProfileId,
        rootFolderPath: targets.rootFolderPath,
        monitored: true,
        addOptions: { searchForMissingEpisodes: true }
      }),
      signal: AbortSignal.timeout(4000)
    });
    if (!addRes.ok) {
      const body = await addRes.text().catch(() => '');
      return { success: false, message: `Sonarr rejected the add request (status ${addRes.status}). ${body}`.trim() };
    }
    const json = (addRes as unknown as { json?: () => Promise<unknown> }).json;
    const added = typeof json === 'function' ? await json.call(addRes) as { id?: number } : {};
    return {
      success: true, mediaId: added.id ? `sonarr-${added.id}` : undefined,
      qualityProfile: targets.qualityProfileName, rootFolder: targets.rootFolderPath,
      message: `Queued "${match.title}" in Sonarr`
    };
  }

  async remove(mediaId: string, deleteFiles = false): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const numericId = mediaId.startsWith('sonarr-') ? mediaId.slice('sonarr-'.length) : mediaId;
    const res = await fetch(`${url}/api/v3/series/${numericId}?deleteFiles=${deleteFiles}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) {
      return { success: false, message: `Sonarr could not remove the series (status ${res.status}).` };
    }
    return { success: true, message: 'Removed from Sonarr.' };
  }

  async getQueue(): Promise<Download[]> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v3/queue?pageSize=100`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Sonarr returned ${res.status} while listing the queue.`);
    const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
    return (body.records ?? []).map(q => {
      const total = (Number(q.size) || 0) as number;
      const left = (Number(q.sizeleft ?? total) || 0) as number;
      const progress = total > 0
        ? Math.max(0, Math.min(100, Math.round(((total - left) / total) * 100)))
        : 0;
      return {
        id: `queue-${String(q.id ?? '')}`,
        sourceClient: 'sonarr',
        downloadId: typeof q.downloadId === 'string' ? q.downloadId : undefined,
        mediaId: q.seriesId ? `sonarr-${String(q.seriesId)}` : undefined,
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
    if (!res.ok) return { success: false, message: `Sonarr could not remove that queue item (status ${res.status}).` };
    return { success: true, message: 'Removed from the queue.' };
  }

  /** Search for specific episodes (numeric ids or `episode-N`). */
  async searchEpisodes(ids: string[]): Promise<{ success: boolean; message: string }> {
    const episodeIds = ids.map(id => Number(id.replace(/^episode-/, ''))).filter(n => Number.isInteger(n) && n > 0);
    if (!episodeIds.length) return { success: false, message: 'No valid episode to search for.' };
    return runArrCommand(this.requireConfig(), 'v3', { name: 'EpisodeSearch', episodeIds }, `a search for ${episodeIds.length === 1 ? 'that episode' : `${episodeIds.length} episodes`}`);
  }

  /** Search for every monitored episode of a show that has aired and has no file. */
  async searchMissing(seriesId: string): Promise<{ success: boolean; message: string; count: number }> {
    const now = Date.now();
    const missing = (await this.getEpisodes(seriesId)).filter(e => e.monitored !== false && !e.hasFile && e.seasonNumber > 0 && (!e.airDate || Date.parse(e.airDate) <= now));
    if (!missing.length) return { success: true, message: 'Nothing is missing.', count: 0 };
    const result = await this.searchEpisodes(missing.map(e => e.id));
    return { ...result, count: missing.length };
  }

  /** Rescan disk for new/changed files and refresh metadata ("Scan library"). */
  async scanLibrary(): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    for (const command of ['RescanSeries', 'RefreshSeries']) {
      const res = await fetch(`${url}/api/v3/command`, {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: command }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return { success: false, message: `Sonarr rejected the scan (status ${res.status}).` };
    }
    return { success: true, message: 'Sonarr is scanning for new files.' };
  }

  async listQualityProfiles(): Promise<QualityProfile[]> {
    return listQualityProfiles(this.requireConfig(), 'sonarr');
  }

  async getQualityProfileId(mediaId: string): Promise<number | null> {
    const numeric = Number(mediaId.startsWith('sonarr-') ? mediaId.slice(7) : mediaId);
    return Number.isInteger(numeric) ? currentQualityProfileId(this.requireConfig(), 'sonarr', numeric) : null;
  }

  /** Change a title's quality profile, optionally searching for that quality now. */
  async setQualityProfile(mediaId: string, profileId: number, search: boolean): Promise<{ success: boolean; message: string }> {
    const numeric = Number(mediaId.startsWith('sonarr-') ? mediaId.slice(7) : mediaId);
    if (!Number.isInteger(numeric)) return { success: false, message: 'Unknown title id.' };
    return changeQualityProfile(this.requireConfig(), 'sonarr', numeric, profileId, search);
  }

  async refreshMetadata(mediaId: string): Promise<{ success: boolean; message: string }> {
    const { url, apiKey } = this.requireConfig();
    const numericId = mediaId.startsWith('sonarr-') ? mediaId.slice('sonarr-'.length) : mediaId;
    const res = await fetch(`${url}/api/v3/command`, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SeriesSearch', seriesId: Number(numericId) }),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return { success: false, message: `Sonarr could not search for that series (status ${res.status}).` };
    return { success: true, message: 'Sonarr search started.' };
  }

  async getHistory(): Promise<{ events: { timestamp: Date; service: string; message: string }[] }> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/v3/history?pageSize=50`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Sonarr returned ${res.status} while listing history.`);
    const body = (await res.json()) as { records?: Array<Record<string, unknown>> };
    return {
      events: (body.records ?? []).map(r => ({
        timestamp: r.date ? new Date(r.date as string) : new Date(),
        service: 'sonarr',
        message: `${(r.eventType as string) ?? 'event'}: ${(r.sourceTitle as string) ?? ''}`.trim()
      }))
    };
  }
}
