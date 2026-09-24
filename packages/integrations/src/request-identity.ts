export type RequestMediaKind = 'movie' | 'series' | 'artist';

/**
 * Joins a base URL and path segments with exactly one slash between parts.
 * The *arr SPA catch-all serves its HTML index page for doubled slashes
 * (for example /api/v3//qualityprofile), so builds must never nest a
 * leading-slash segment inside a template that already adds one.
 */
export function joinApiUrl(base: string, ...parts: string[]): string {
  return [base.replace(/\/+$/, ''), ...parts.map(p => p.replace(/^\/+|\/+$/g, ''))].join('/');
}

/**
 * Reads a response body as JSON or throws a readable error when the service
 * serves something else (an HTML login or index page, or invalid JSON), so
 * request failures surface an clear message instead of a raw parse error.
 */
async function readJsonArray<T>(res: Response, what: string): Promise<T[]> {
  const text = await res.text();
  if (!text.trim()) throw new Error(`${what} returned an empty response. Nothing was added.`);
  if (/^\s*<!doctype/i.test(text) || /^<!DOCTYPE/i.test(text)) {
    throw new Error(`${what} returned an HTML page instead of JSON. Check the service URL and API key; nothing was added.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${what} returned an invalid response. Check the service URL and API key; nothing was added.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${what} returned an unexpected response. Nothing was added.`);
  return parsed as T[];
}

/** Metadata IDs, not the local *arr library IDs. */
export interface RequestCandidate {
  provider: 'tmdb' | 'tvdb' | 'musicbrainz';
  providerId: string;
  title: string;
  year?: number;
  type: RequestMediaKind;
  overview?: string;
  poster?: string;
  popularity?: number;
}

export interface RequestSelectionInput {
  title: string;
  type: string;
  year?: number;
  qualityProfile?: string;
  /** True when the user picked the profile: an unknown name is an error, not a fallback. */
  qualityStrict?: boolean;
  selectedProviderId?: string;
  /** Movies only: add without searching and hold off until a proper (digital or disc) release exists. */
  wait?: boolean;
}

export interface RequestAddResult {
  success: boolean;
  message: string;
  mediaId?: string;
  code?: 'ambiguous' | 'no_match' | 'invalid_selection';
  candidates?: RequestCandidate[];
  /** Quality profile and root folder resolved from the live instance, so the
   *  request ledger shows what was actually used rather than a label. */
  qualityProfile?: string;
  rootFolder?: string;
}

// Canonical Unicode composition and case folding only. Do not erase punctuation,
// accents or non-Latin text: those differences can distinguish real identities.
export function normalizeRequestTitle(title: string): string {
  return title.normalize('NFC').trim().toLowerCase();
}

export function selectRequestCandidate(candidates: RequestCandidate[], req: RequestSelectionInput):
  { candidate: RequestCandidate } | { failure: RequestAddResult } {
  const unique = candidates.filter((c, i) => candidates.findIndex(other =>
    other.providerId === c.providerId && other.title === c.title && other.year === c.year && other.type === c.type
  ) === i);
  const matches = unique.filter(c => c.type === req.type &&
    normalizeRequestTitle(c.title) === normalizeRequestTitle(req.title) &&
    (req.year === undefined || c.year === req.year) &&
    (req.selectedProviderId === undefined || c.providerId === req.selectedProviderId));
  // A selected ID is still checked against current lookup metadata and title/year.
  if (matches.length === 1) return { candidate: matches[0]! };
  const code = req.selectedProviderId !== undefined ? 'invalid_selection' : matches.length > 1 ? 'ambiguous' : 'no_match';
  return { failure: {
    success: false,
    code,
    message: code === 'ambiguous'
      ? `Multiple metadata results match "${req.title}". Choose a provider ID, title and year before requesting.`
      : code === 'invalid_selection'
        ? 'The selected identity no longer matches the metadata lookup. Look up candidates and select again.'
        : `No confident metadata match for "${req.title}"${req.year !== undefined ? ` (${req.year})` : ''}. Look up candidates and choose the intended title; nothing was added.`,
    candidates: unique
  } };
}

/** Lookup only: never posts, searches for downloads, or mutates configuration. */
export async function lookupRequestCandidates(config: { url: string; apiKey: string }, service: 'radarr' | 'sonarr' | 'lidarr', title: string): Promise<RequestCandidate[]> {
  const settings = {
    radarr: { path: '/api/v3/movie/lookup', id: 'tmdbId', title: 'title', provider: 'tmdb', type: 'movie' },
    sonarr: { path: '/api/v3/series/lookup', id: 'tvdbId', title: 'title', provider: 'tvdb', type: 'series' },
    lidarr: { path: '/api/v1/artist/lookup', id: 'foreignArtistId', title: 'artistName', provider: 'musicbrainz', type: 'artist' }
  } as const;
  const spec = settings[service];
  const response = await fetch(joinApiUrl(config.url, spec.path) + `?term=${encodeURIComponent(title.trim())}`, {
    headers: { 'X-Api-Key': config.apiKey },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`${service} metadata lookup failed (status ${response.status}). Nothing was added.`);
  const rows = await readJsonArray<Record<string, unknown>>(response, `${service} metadata lookup`);
  return rows.flatMap((row: Record<string, unknown>) => {
    if (!row || typeof row !== 'object') return [];
    const id = row[spec.id];
    const name = row[spec.title];
    const validId = service === 'lidarr'
      ? typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      : typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
    if (!validId || typeof name !== 'string' || !name.trim()) return [];
    const images = Array.isArray(row.images) ? row.images as Array<{ coverType?: string; remoteUrl?: string; url?: string }> : [];
    const posterImage = images.find(i => i.coverType === 'poster') ?? images.find(i => i.coverType === 'cover');
    const poster = posterImage?.remoteUrl ?? (posterImage?.url?.startsWith('http') ? posterImage.url : undefined);
    const ratings = row.ratings as { tmdb?: { votes?: number }; votes?: number; value?: number } | undefined;
    const popularity = typeof row.popularity === 'number' ? row.popularity : (ratings?.tmdb?.votes ?? ratings?.votes);
    return [{
      provider: spec.provider, providerId: String(id), title: name, type: spec.type,
      ...(typeof row.year === 'number' && Number.isInteger(row.year) && row.year > 0 ? { year: row.year } : {}),
      ...(typeof row.overview === 'string' ? { overview: row.overview } : {}),
      ...(poster ? { poster } : {}),
      ...(typeof popularity === 'number' && Number.isFinite(popularity) ? { popularity } : {})
    }];
  }).sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1));
}

export interface ResolvedAddTargets {
  qualityProfileId: number;
  qualityProfileName: string;
  rootFolderPath: string;
  metadataProfileId?: number;
}

/**
 * Resolves the add configuration from the connected instance instead of
 * hardcoding quality profile IDs or root folder paths that may not exist on
 * the user's server. Preferred profile matches by name when given; otherwise
 * the first usable profile is used. A missing/inaccessible set of targets is a
 * real error (the add cannot be configured correctly), never a silent fallback.
 */
export async function resolveAddTargets(
  config: { url: string; apiKey: string },
  service: 'radarr' | 'sonarr' | 'lidarr',
  preferredProfile?: string,
  strict = false
): Promise<ResolvedAddTargets> {
  const spec = service === 'lidarr'
    ? { root: '/api/v1', quality: 'qualityprofile', folders: 'rootfolder' }
    : { root: '/api/v3', quality: 'qualityprofile', folders: 'rootfolder' };
  const headers = { 'X-Api-Key': config.apiKey };
  const profilesUrl = joinApiUrl(config.url, spec.root, spec.quality);
  const foldersUrl = joinApiUrl(config.url, spec.root, spec.folders);
  const [profilesRes, foldersRes] = await Promise.all([
    fetch(profilesUrl, { headers, signal: AbortSignal.timeout(4000) }),
    fetch(foldersUrl, { headers, signal: AbortSignal.timeout(4000) })
  ]);
  if (!profilesRes.ok) throw new Error(`${service} returned ${profilesRes.status} while reading quality profiles. Nothing was added.`);
  if (!foldersRes.ok) throw new Error(`${service} returned ${foldersRes.status} while reading root folders. Nothing was added.`);
  const profiles = await readJsonArray<{ id?: number; name?: string }>(profilesRes, `${service} quality profiles`);
  const folders = await readJsonArray<{ path?: string; accessible?: boolean }>(foldersRes, `${service} root folders`);
  const usable = profiles.filter(p => typeof p.id === 'number' && typeof p.name === 'string');
  const named = preferredProfile ? usable.find(p => p.name!.toLowerCase() === preferredProfile.trim().toLowerCase()) : undefined;
  if (strict && preferredProfile && !named) {
    throw new Error(`${service} has no quality profile called "${preferredProfile}". Available: ${usable.map(p => p.name).join(', ') || 'none'}. Nothing was added.`);
  }
  // Music: an unknown name falls back to "Standard", then "Best available", then "Lossless", never plain "Any".
  const profile = named ?? (service === 'lidarr' ? usable.find(p => /^standard$/i.test(p.name!)) ?? usable.find(p => /best available/i.test(p.name!)) ?? usable.find(p => /lossless/i.test(p.name!)) : undefined) ?? usable[0];
  if (!profile) throw new Error(`${service} has no quality profiles configured. Create one in ${service} before requesting titles.`);
  const folder = folders.find(f => typeof f.path === 'string' && f.path.length > 0 && f.accessible !== false);
  if (!folder) throw new Error(`${service} has no accessible root folder configured. Add one in ${service} before requesting titles.`);
  const targets: ResolvedAddTargets = {
    qualityProfileId: profile.id!,
    qualityProfileName: profile.name!,
    rootFolderPath: folder.path!
  };
  if (service === 'lidarr') {
    // Lidarr also requires a metadata profile; resolve it the same way.
    try {
      const metaRes = await fetch(joinApiUrl(config.url, spec.root, 'metadataprofile'), { headers, signal: AbortSignal.timeout(4000) });
      if (metaRes.ok) {
        const metas = await readJsonArray<{ id?: number; name?: string }>(metaRes, `${service} metadata profiles`);
        const meta = metas.find(m => typeof m.id === 'number' && typeof m.name === 'string');
        if (meta) targets.metadataProfileId = meta.id;
      }
    } catch {
      // Metadata profile is optional in the POST body on recent Lidarr versions.
    }
  }
  return targets;
}

export interface QualityProfile { id: number; name: string }

const SERVICE_ROOT = { radarr: '/api/v3', sonarr: '/api/v3', lidarr: '/api/v1' } as const;
const SERVICE_RESOURCE = { radarr: 'movie', sonarr: 'series', lidarr: 'artist' } as const;

/** Quality profiles configured in the connected service (e.g. HD-1080p, Ultra-HD). */
export async function listQualityProfiles(config: { url: string; apiKey: string }, service: 'radarr' | 'sonarr' | 'lidarr'): Promise<QualityProfile[]> {
  const res = await fetch(joinApiUrl(config.url, SERVICE_ROOT[service], 'qualityprofile'), {
    headers: { 'X-Api-Key': config.apiKey }, signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`${service} returned ${res.status} while reading quality profiles.`);
  const rows = await readJsonArray<{ id?: number; name?: string }>(res, `${service} quality profiles`);
  return rows.flatMap(r => (typeof r.id === 'number' && typeof r.name === 'string' ? [{ id: r.id, name: r.name }] : []));
}

/** Switch an existing title to another quality profile and optionally search for that quality now. */
export async function changeQualityProfile(
  config: { url: string; apiKey: string },
  service: 'radarr' | 'sonarr' | 'lidarr',
  numericId: number,
  profileId: number,
  search: boolean
): Promise<{ success: boolean; message: string }> {
  const root = SERVICE_ROOT[service];
  const resource = SERVICE_RESOURCE[service];
  const headers = { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json' };
  const getRes = await fetch(joinApiUrl(config.url, root, resource, String(numericId)), { headers, signal: AbortSignal.timeout(5000) });
  if (!getRes.ok) return { success: false, message: `${service} could not find that title (status ${getRes.status}).` };
  const item = await getRes.json() as Record<string, unknown>;
  item.qualityProfileId = profileId;
  const putRes = await fetch(joinApiUrl(config.url, root, resource, String(numericId)) + '?moveFiles=false', {
    method: 'PUT', headers, body: JSON.stringify(item), signal: AbortSignal.timeout(8000)
  });
  if (!putRes.ok) return { success: false, message: `${service} rejected the quality change (status ${putRes.status}).` };
  if (!search) return { success: true, message: 'Quality profile updated.' };
  const command = service === 'radarr' ? { name: 'MoviesSearch', movieIds: [numericId] }
    : service === 'sonarr' ? { name: 'SeriesSearch', seriesId: numericId }
      : { name: 'ArtistSearch', artistId: numericId };
  const cmd = await fetch(joinApiUrl(config.url, root, 'command'), { method: 'POST', headers, body: JSON.stringify(command), signal: AbortSignal.timeout(6000) });
  if (!cmd.ok) return { success: true, message: 'Quality profile updated, but the search could not be started.' };
  return { success: true, message: 'Quality updated. Searching for a release in that quality.' };
}

/** The quality profile id a tracked title currently uses. */
export async function currentQualityProfileId(config: { url: string; apiKey: string }, service: 'radarr' | 'sonarr' | 'lidarr', numericId: number): Promise<number | null> {
  const res = await fetch(joinApiUrl(config.url, SERVICE_ROOT[service], SERVICE_RESOURCE[service], String(numericId)), {
    headers: { 'X-Api-Key': config.apiKey }, signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) return null;
  const item = await res.json() as { qualityProfileId?: number };
  return typeof item.qualityProfileId === 'number' ? item.qualityProfileId : null;
}

const IMPORT_FAILED = new Set(['importfailed', 'importblocked', 'failedpending', 'failed', 'ignored']);

/** Plain-language reason from a queue record's status messages. */
function explainMessage(text: string): string {
  if (/destination already exists/i.test(text)) return 'A file with the same name is already in the library folder, so the import stopped. Turn on file renaming, then retry.';
  if (/not close enough|match is not/i.test(text)) return 'The download does not match the wanted release closely enough. Import it by hand or search for a different copy.';
  if (/no files found are eligible|no audio files|not a valid/i.test(text)) return 'No usable media files were found in the download.';
  if (/sample/i.test(text)) return 'The download only contained a sample.';
  if (/unable to parse|unknown (movie|series|artist|album)/i.test(text)) return 'The release name could not be matched to a title. Import it by hand.';
  if (/not enough free space|disk space/i.test(text)) return 'There is not enough free disk space to import it.';
  return text;
}

/**
 * A finished transfer can still fail to import. The *arr queue says so in
 * trackedDownloadState and statusMessages; surface it instead of a green "completed".
 */
export function queueProblem(q: Record<string, unknown>): { status?: 'warning'; message?: string } {
  const state = String(q.trackedDownloadState ?? '').toLowerCase();
  const tracked = String(q.trackedDownloadStatus ?? '').toLowerCase();
  if (!IMPORT_FAILED.has(state) && tracked !== 'error' && !(tracked === 'warning' && state !== 'downloading')) return {};
  const messages = Array.isArray(q.statusMessages) ? q.statusMessages as Array<{ title?: string; messages?: string[] }> : [];
  const first = messages.flatMap(m => m.messages ?? []).find(Boolean) ?? (typeof q.errorMessage === 'string' ? q.errorMessage : '');
  return { status: 'warning', message: first ? explainMessage(first) : 'The download finished but could not be imported.' };
}

/** Run an *arr command (search, refresh, rescan) and report whether it was accepted. */
export async function runArrCommand(
  config: { url: string; apiKey: string }, version: 'v1' | 'v3', body: Record<string, unknown>, what: string
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(joinApiUrl(config.url, `/api/${version}/command`), {
    method: 'POST',
    headers: { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return { success: false, message: `The service could not start ${what} (status ${res.status}).` };
  return { success: true, message: `Started ${what}. New downloads appear on the Downloads page.` };
}
