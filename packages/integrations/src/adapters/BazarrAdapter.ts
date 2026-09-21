import { IntegrationAdapter } from '../adapter-interface.js';
import { Media } from '@virtuallyview/types';

export interface SubtitleWantedItem {
  id: string;
  title: string;
  type: 'movie' | 'episode';
  missingLanguages: string[];
}

/**
 * Bazarr does not have its own library: it manages subtitles for movies and
 * episodes that already exist in Radarr/Sonarr. getItems()/search() report
 * subtitle status rather than media the way the other adapters do, and
 * add()/remove() are not meaningful for it.
 */
export class BazarrAdapter implements IntegrationAdapter<{ url: string; apiKey: string }> {
  id = 'bazarr';
  name = 'Bazarr';
  private config: { url: string; apiKey: string } | null = null;

  async connect(config: { url: string; apiKey: string }) {
    this.config = config;
    return { connected: true, message: 'Connected to Bazarr' };
  }

  async disconnect() {
    this.config = null;
  }

  async healthCheck() {
    if (!this.config) return { healthy: false, status: 'offline' };
    try {
      const res = await fetch(`${this.config.url}/api/system/status`, {
        headers: { 'X-API-KEY': this.config.apiKey },
        signal: AbortSignal.timeout(2500)
      });
      return {
        healthy: res.ok,
        status: res.status === 401 ? 'setup_required' : (res.ok ? 'online' : 'offline')
      };
    } catch {
      return { healthy: false, status: 'offline' };
    }
  }

  async getStatus() {
    const health = await this.healthCheck();
    return {
      name: 'Bazarr',
      adapter: 'bazarr',
      enabled: true,
      healthStatus: health.status,
      url: this.config?.url ?? 'http://localhost:6767',
      lastSync: new Date()
    };
  }

  private requireConfig(): { url: string; apiKey: string } {
    if (!this.config) throw new Error('Bazarr is not connected. Add its URL and API key in Settings.');
    return this.config;
  }

  async getMissingSubtitles(): Promise<SubtitleWantedItem[]> {
    const { url, apiKey } = this.requireConfig();
    const headers = { 'X-API-KEY': apiKey };

    const [moviesRes, episodesRes] = await Promise.all([
      fetch(`${url}/api/movies/wanted`, { headers, signal: AbortSignal.timeout(4000) }),
      fetch(`${url}/api/episodes/wanted`, { headers, signal: AbortSignal.timeout(4000) })
    ]);
    if (!moviesRes.ok && !episodesRes.ok) {
      throw new Error(`Bazarr returned an error while listing wanted subtitles.`);
    }

    const out: SubtitleWantedItem[] = [];
    if (moviesRes.ok) {
      const body = (await moviesRes.json()) as { data?: Array<Record<string, unknown>> };
      for (const m of body.data ?? []) {
        out.push({
          id: `bazarr-movie-${m.radarrId}`,
          title: (m.title as string) ?? 'Unknown movie',
          type: 'movie',
          missingLanguages: (m.missing_subtitles as Array<{ name?: string }> | undefined)?.map(l => l.name ?? '?') ?? []
        });
      }
    }
    if (episodesRes.ok) {
      const body = (await episodesRes.json()) as { data?: Array<Record<string, unknown>> };
      for (const e of body.data ?? []) {
        out.push({
          id: `bazarr-episode-${e.sonarrEpisodeId}`,
          title: `${(e.seriesTitle as string) ?? 'Unknown series'} - ${(e.episode_number as string) ?? ''}`.trim(),
          type: 'episode',
          missingLanguages: (e.missing_subtitles as Array<{ name?: string }> | undefined)?.map(l => l.name ?? '?') ?? []
        });
      }
    }
    return out;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const { url, apiKey } = this.requireConfig();
    return fetch(`${url}/api${path}`, { ...init, headers: { 'X-API-KEY': apiKey, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(90_000) });
  }

  /** Languages switched on in Bazarr, for the picker. */
  async enabledLanguages(): Promise<Array<{ code: string; name: string }>> {
    const res = await this.call('/system/languages');
    if (!res.ok) throw new Error(`Bazarr returned ${res.status} while listing languages.`);
    const rows = (await res.json()) as Array<{ code2?: string; name?: string; enabled?: boolean }>;
    return rows.filter(r => r.enabled && r.code2).map(r => ({ code: r.code2 as string, name: r.name ?? (r.code2 as string) }));
  }

  /** Give a title the first language profile so Bazarr keeps looking for its subtitles. */
  private async ensureProfile(kind: 'movie' | 'series', id: number): Promise<void> {
    const profiles = await this.call('/system/languages/profiles');
    const first = profiles.ok ? ((await profiles.json()) as Array<{ profileId?: number }>)[0]?.profileId : undefined;
    if (first === undefined) return;
    const query = kind === 'movie' ? `radarrid=${id}&profileid=${first}` : `seriesid=${id}&profileid=${first}`;
    await this.call(kind === 'movie' ? `/movies?${query}` : `/series?${query}`, { method: 'POST' }).catch(() => undefined);
  }

  private static outcome(res: Response, ok: string, what: string): { success: boolean; message: string } {
    if (res.ok) return { success: true, message: ok };
    if (res.status === 404 || res.status === 500) return { success: false, message: `No ${what} was found by any subtitle source. Try another language, upload a file, or try again later.` };
    return { success: false, message: `Bazarr could not do that (status ${res.status}).` };
  }

  /** Search the subtitle sources for one movie in one language. */
  async searchMovieSubtitles(radarrId: number, language: string): Promise<{ success: boolean; message: string }> {
    await this.ensureProfile('movie', radarrId);
    const res = await this.call(`/movies/subtitles?radarrid=${radarrId}&language=${encodeURIComponent(language)}&forced=False&hi=False`, { method: 'PATCH' });
    return BazarrAdapter.outcome(res, 'Subtitle downloaded. Reload the player to use it.', 'subtitle');
  }

  async searchEpisodeSubtitles(seriesId: number, episodeId: number, language: string): Promise<{ success: boolean; message: string }> {
    await this.ensureProfile('series', seriesId);
    const res = await this.call(`/episodes/subtitles?seriesid=${seriesId}&episodeid=${episodeId}&language=${encodeURIComponent(language)}&forced=False&hi=False`, { method: 'PATCH' });
    return BazarrAdapter.outcome(res, 'Subtitle downloaded. Reload the player to use it.', 'subtitle');
  }

  /** Upload a subtitle file for a movie. It is saved next to the video by Bazarr. */
  async uploadMovieSubtitle(radarrId: number, language: string, filename: string, data: Buffer): Promise<{ success: boolean; message: string }> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)]), filename);
    const res = await this.call(`/movies/subtitles?radarrid=${radarrId}&language=${encodeURIComponent(language)}&forced=False&hi=False`, { method: 'POST', body: form });
    return BazarrAdapter.outcome(res, 'Subtitle uploaded. Reload the player to use it.', 'usable subtitle in that file');
  }

  async uploadEpisodeSubtitle(seriesId: number, episodeId: number, language: string, filename: string, data: Buffer): Promise<{ success: boolean; message: string }> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)]), filename);
    const res = await this.call(`/episodes/subtitles?seriesid=${seriesId}&episodeid=${episodeId}&language=${encodeURIComponent(language)}&forced=False&hi=False`, { method: 'POST', body: form });
    return BazarrAdapter.outcome(res, 'Subtitle uploaded. Reload the player to use it.', 'usable subtitle in that file');
  }

  /** Assistant helper: ids look like bazarr-movie-12 or bazarr-episode-345. */
  async downloadSubtitle(mediaId: string, language: string): Promise<{ success: boolean; message: string }> {
    const numeric = Number(mediaId.replace(/^bazarr-(movie|episode)-/, ''));
    if (!Number.isInteger(numeric)) return { success: false, message: 'Unknown item id.' };
    if (!mediaId.startsWith('bazarr-episode-')) return this.searchMovieSubtitles(numeric, language);
    const res = await this.call(`/episodes?episodeid[]=${numeric}`);
    const row = res.ok ? ((await res.json()) as { data?: Array<{ sonarrSeriesId?: number }> }).data?.[0] : undefined;
    return row?.sonarrSeriesId ? this.searchEpisodeSubtitles(row.sonarrSeriesId, numeric, language) : { success: false, message: 'Bazarr does not know that episode.' };
  }

  async search(): Promise<Media[]> {
    return [];
  }

  async getItems(): Promise<Media[]> {
    return [];
  }

  async getItem(): Promise<Media | null> {
    return null;
  }

  async add(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Bazarr manages subtitles for existing Radarr/Sonarr media; it has nothing of its own to add.' };
  }

  async remove(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Not supported by Bazarr.' };
  }

  async getQueue() {
    return [];
  }

  async refreshMetadata(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Not supported by Bazarr.' };
  }

  async getHistory(): Promise<{ events: { timestamp: Date; service: string; message: string }[] }> {
    const { url, apiKey } = this.requireConfig();
    const res = await fetch(`${url}/api/history/movies`, {
      headers: { 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`Bazarr returned ${res.status} while listing history.`);
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return {
      events: (body.data ?? []).map(r => ({
        timestamp: r.timestamp ? new Date((r.timestamp as number) * 1000) : new Date(),
        service: 'bazarr',
        message: `${(r.action as string) ?? 'event'}: ${(r.title as string) ?? ''}`.trim()
      }))
    };
  }
}
