import { getServerSettings } from './server-settings.js';
import { notify } from './notifications.js';
import { currentActor } from './user-context.js';
import { cinemaNotice, isStillInCinemas, type ReleaseDates } from './release-check.js';
import { retryTitle } from './retry.js';
import type { ProwlarrAdapter } from '@virtuallyview/integrations';
import type { RadarrAdapter, SonarrAdapter, LidarrAdapter } from '@virtuallyview/integrations';
type RequestCandidate = Awaited<ReturnType<RadarrAdapter['lookupCandidates']>>[number];
import { getAdapter } from './registry.js';
import { createDownload, updateDownload } from './downloads.js';
import { all as dbAll, run as dbRun } from '../db/app-db.js';

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
  requesterId?: string;
  message?: string;
  providerId?: string;
  /** Metadata identity retained in memory across retries; providerId above is the local library ID. */
  selectedProviderId?: string;
  metadataProvider?: RequestCandidate['provider'];
  /** Added without a search; a proper release is downloaded when one appears. */
  waitForRelease?: boolean;
  /** When the media service was last asked to look for it, and how many times. */
  searchedAt?: string;
  searches?: number;
  events?: RequestEvent[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Rolling activity feed for a request (Perplexity-style "what is happening
 * right now"). Entries are real pipeline events only: they are appended when
 * the pipeline actually does something, never on a timer.
 */
export interface RequestEvent {
  at: string;
  text: string;
}

const MAX_EVENTS_PER_REQUEST = 30;

/** Append a real pipeline event to a request's rolling feed. */
export function logEvent(id: string, text: string): void {
  const request = requests.find(r => r.id === id);
  if (!request) return;
  const events = request.events ?? [];
  const last = events[events.length - 1];
  if (last?.text === text) return; // no duplicate consecutive lines
  events.push({ at: now(), text });
  request.events = events.slice(-MAX_EVENTS_PER_REQUEST);
  request.updatedAt = now();
}

const SERVICE_BY_TYPE: Record<MediaKind, { key: string; rootFolder: string }> = {
  movie: { key: 'radarr', rootFolder: '/media/movies' },
  series: { key: 'sonarr', rootFolder: '/media/tv' },
  artist: { key: 'lidarr', rootFolder: '/media/music' }
};

function adapterFor(mediaType: MediaKind): RadarrAdapter | SonarrAdapter | LidarrAdapter {
  return getAdapter<RadarrAdapter | SonarrAdapter | LidarrAdapter>(SERVICE_BY_TYPE[mediaType].key);
}

export async function lookupCandidates(title: string, mediaType: MediaKind = 'movie'): Promise<RequestCandidate[]> {
  return adapterFor(mediaType).lookupCandidates(title);
}

type LibraryItem = {
  id: string; title: string; year?: number; status?: string;
  provider?: { metadata?: Record<string, unknown> };
};

type RequestSelection = Awaited<ReturnType<RadarrAdapter['resolveCandidate']>>;

function matchesMetadata(item: LibraryItem, provider: RequestCandidate['provider'], id: string): boolean {
  const key = provider === 'tmdb' ? 'tmdbId' : provider === 'tvdb' ? 'tvdbId' : 'foreignArtistId';
  return String(item.provider?.metadata?.[key] ?? '') === id;
}

const downloadByRequest = new Map<string, string>();
const lastLoggedProgress = new Map<string, number>();

const SERVICE_LABELS: Record<string, string> = { radarr: 'Radarr', sonarr: 'Sonarr', lidarr: 'Lidarr' };

let requests: RequestItem[] = [];
let seq = 100;

function now(): string {
  return new Date().toISOString();
}

function persist(): void {
  try {
    dbRun('DELETE FROM requests');
    const insert = dbRun;
    for (const r of requests) {
      insert('INSERT INTO requests (id, payload, updated_at) VALUES (?, ?, ?)', r.id, JSON.stringify(r), r.updatedAt);
    }
  } catch {
    // Persistence is best-effort; the in-memory ledger still works.
  }
}

function loadRequests(): void {
  try {
    const rows = dbAll<{ id: string; payload: string }>('SELECT id, payload FROM requests');
    const restored = rows
      .map(row => {
        try { return JSON.parse(row.payload) as RequestItem; } catch { return null; }
      })
      .filter((r): r is RequestItem => Boolean(r));
    if (restored.length) {
      requests = restored;
      seq = restored.reduce((max, r) => {
        const m = /^request-(\d+)$/.exec(r.id);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 100) + 1;
    }
  } catch {
    // Fresh or corrupt store: start empty.
  }
}

loadRequests();

function normalizeTitle(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

function patch(id: string, changes: Partial<RequestItem>) {
  requests = requests.map(r =>
    r.id === id ? { ...r, ...changes, updatedAt: now() } : r
  );
  persist();
}

function providerIdFrom(result: { success: boolean; message: string } | { success: boolean; message: string; mediaId?: string }): string | undefined {
  return 'mediaId' in result && typeof result.mediaId === 'string' ? result.mediaId : undefined;
}

const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: 'Queued',
  searching: 'Searching release sources',
  downloading: 'Downloading',
  importing: 'Importing to library',
  available: 'Available in library',
  failed: 'Failed',
  cancelled: 'Cancelled'
};

/** Append a status-transition event with the real service name. */
function logStatusChange(id: string, from: RequestStatus, to: RequestStatus): void {
  if (from === to) return;
  const mediaType = getRequest(id)?.mediaType ?? 'movie';
  const service = SERVICE_LABELS[SERVICE_BY_TYPE[mediaType].key] ?? 'media service';
  logEvent(id, `${STATUS_LABELS[to]} · ${service} checked`);
  const req = getRequest(id);
  if (req && (to === 'available' || to === 'failed')) {
    const link = req.mediaType === 'movie' ? `/movies/${req.providerId ?? ''}` : req.mediaType === 'series' ? `/series/${req.providerId ?? ''}` : `/music/${req.providerId ?? ''}`;
    notify({
      type: to === 'available' ? 'request.available' : 'request.failed',
      title: to === 'available' ? `${req.title} is ready to watch` : `${req.title} could not be added`,
      ...(req.message && to === 'failed' ? { body: req.message } : {}),
      link: to === 'available' && req.providerId ? link : '/requests',
      ...(req.requesterId ? { userId: req.requesterId } : { role: 'admin' as const })
    });
  }
}

/** Log download progress at most every 5 percentage points. */
function logProgress(id: string, progress: number): void {
  const previous = lastLoggedProgress.get(id);
  if (previous !== undefined && Math.abs(progress - previous) < 5) return;
  lastLoggedProgress.set(id, progress);
  if (progress > 0) logEvent(id, `Download progress ${Math.round(progress)}%`);
}



export function getRequests(): RequestItem[] {
  return requests.map(r => ({ ...r }));
}

export function getRequest(id: string): RequestItem | undefined {
  return requests.find(r => r.id === id);
}

export interface CreateRequestInput {
  title: string;
  year?: number;
  overview?: string;
  requester?: string;
  mediaType?: MediaKind;
  selectedProviderId?: string;
  /** Quality profile name chosen by the user (e.g. "Ultra-HD"). */
  qualityProfile?: string;
  /** For a film with no home release yet: 'wait' for a proper copy, or 'now' to take a camera copy. */
  releaseChoice?: 'wait' | 'now';
}

export interface CreateRequestResult {
  ok: boolean;
  release?: ReleaseDates;
  request?: RequestItem;
  message?: string;
  code?: string;
  candidates?: RequestCandidate[];
}

/**
 * Library-first match for a requested title. The metadata lookup (TMDB etc.)
 * can fail on title formatting ("Batman, The" vs "The Batman") or when the
 * metadata service is unreachable, which made hero requests fail even when the
 * title was already tracked in the local *arr library. When an existing
 * library entry matches by normalized title (and year, when given), we never
 * need the metadata hop: trigger a search for the local entry and move on.
 */
async function findInLibrary(adapter: { getItems: () => Promise<unknown[]> }, title: string, year?: number): Promise<LibraryItem | undefined> {
  let items: unknown[] = [];
  try {
    items = await adapter.getItems();
  } catch {
    return undefined;
  }
  const wanted = normalizeTitle(title);
  const candidates = (items as LibraryItem[]).filter((m): m is LibraryItem => Boolean(m && m.title));
  const exact = candidates.find(m => normalizeTitle(m.title) === wanted && (year === undefined || m.year === year));
  if (exact) return exact;
  return candidates.find(m => normalizeTitle(m.title) === wanted);
}

type LibraryFallbackAdapter = {
  getItems: () => Promise<unknown[]>;
  refreshMetadata: (mediaId: string) => Promise<{ success: boolean; message: string }>;
};

/**
 * Library-only request path, used when the metadata lookup cannot produce a
 * selection (unreachable service, or no confident match). If the title is
 * already tracked locally, a search is started for the local entry; if it is
 * already available, the request is rejected as a duplicate instead. Returns
 * null when the title is not in the local library, so the caller reports the
 * original lookup outcome.
 */
async function tryLibraryFallback(
  adapter: LibraryFallbackAdapter,
  request: RequestItem,
  title: string,
  year?: number
): Promise<CreateRequestResult | null> {
  const local = await findInLibrary(adapter, title, year);
  if (!local) return null;
  if (local.status === 'available') {
    const message = `"${local.title}" is already in your library and available.`;
    patch(request.id, { status: 'failed', message });
    logStatusChange(request.id, 'pending', 'failed');
    return { ok: false, request: getRequest(request.id), message };
  }
  if (getRequest(request.id)?.status === 'cancelled') {
    return { ok: false, request: getRequest(request.id), message: 'Request was cancelled.' };
  }
  logEvent(request.id, `Found "${local.title}" in the library; starting a search`);
  const addResult = await adapter.refreshMetadata(local.id);
  if (getRequest(request.id)?.status === 'cancelled') {
    return { ok: false, request: getRequest(request.id), message: 'Request was cancelled.' };
  }
  if (!addResult.success) {
    patch(request.id, { status: 'failed', message: addResult.message });
    logStatusChange(request.id, 'pending', 'failed');
    logEvent(request.id, addResult.message);
    return { ok: false, request: getRequest(request.id), ...addResult };
  }
  logStatusChange(request.id, 'pending', 'searching');
  patch(request.id, { status: 'searching', progress: 5, providerId: local.id });
  return { ok: true, request: getRequest(request.id) };
}

/** Turn low-level fetch/JSON failures into something a person can act on. */
function friendlyServiceError(error: unknown, service: string): string {
  const raw = error instanceof Error ? error.message : 'The media service request failed.';
  if (/Unexpected token '<'|is not valid JSON|<!doctype/i.test(raw)) {
    return `${service} answered with a web page instead of data, so it is most likely down, restarting, or its URL/API key is wrong. Check Settings > Services, then retry.`;
  }
  if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|timed out|aborted/i.test(raw)) {
    return `${service} could not be reached (${raw}). Check that it is running, then retry.`;
  }
  return raw;
}

export async function createRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { ok: false, message: 'A title is required to request media.' };
  const mediaType = input.mediaType ?? 'movie';
  if (!Object.hasOwn(SERVICE_BY_TYPE, mediaType)) return { ok: false, message: 'Choose movie, series or artist.' };
  if (input.year !== undefined && (!Number.isInteger(input.year) || input.year < 1)) return { ok: false, message: 'Year must be a positive integer.' };
  if (input.selectedProviderId !== undefined && (typeof input.selectedProviderId !== 'string' || !input.selectedProviderId.trim())) {
    return { ok: false, message: 'Selected provider ID must be a non-empty string.' };
  }
  const actor = currentActor();
  const rules = getServerSettings().requests;
  if (actor.role === 'user' && rules.limit > 0) {
    const since = Date.now() - (rules.window === 'day' ? 86_400_000 : 7 * 86_400_000);
    const used = requests.filter(r => r.requesterId === actor.userId && r.status !== 'cancelled' && Date.parse(r.createdAt) >= since).length;
    if (used >= rules.limit) {
      return { ok: false, code: 'limit', message: `You have used your ${rules.limit} request${rules.limit === 1 ? '' : 's'} for this ${rules.window}. Ask an administrator or try again later.` } as CreateRequestResult;
    }
  }
  const { key: service, rootFolder } = SERVICE_BY_TYPE[mediaType];
  const chosenQuality = typeof input.qualityProfile === 'string' ? input.qualityProfile.trim() : '';
  const quality = chosenQuality || getServerSettings().defaultQuality?.[mediaType]?.trim() || (mediaType === 'artist' ? 'Lossless' : 'HD-1080p');
  const request: RequestItem = {
    id: `request-${seq++}`, title, year: input.year, overview: input.overview,
    selectedProviderId: input.selectedProviderId, status: 'pending', service, mediaType,
    qualityProfile: quality, rootFolder, requester: input.requester ?? (actor.role === 'system' ? 'you' : actor.username), ...(actor.role !== 'system' ? { requesterId: actor.userId } : {}),
    createdAt: now(), updatedAt: now()
  };
  // Memory-only history would vanish on restart; persist so every device and
  // every session sees the same ledger.
  requests = [request, ...requests];
  persist();
  logEvent(request.id, `Request created for "${title}"`);
  const adapter = adapterFor(mediaType);
  try {
    logEvent(request.id, `Looking up metadata identity`);
    // The metadata lookup runs first and keeps the request contract: a
    // working lookup posts the selected identity, and ambiguous candidate
    // sets are surfaced so the user chooses. The local library is only
    // consulted when the lookup cannot produce a selection.
    let selection: RequestSelection;
    try {
      selection = await adapter.resolveCandidate({
        title, type: mediaType, year: input.year, selectedProviderId: input.selectedProviderId
      });
    } catch (lookupError) {
      // Lookup unreachable (offline metadata service, HTTP error). A title
      // that is already tracked locally can still be searched directly, so
      // requests from the hero survive the metadata hop being down.
      const fallback = await tryLibraryFallback(adapter, request, title, input.year);
      if (fallback) return fallback;
      throw lookupError;
    }
    if ('failure' in selection) {
      // Ambiguity is a real fork in the road: never auto-pick one, show the
      // candidates so the user decides.
      if (selection.failure.code === 'ambiguous') {
        patch(request.id, { status: 'failed', message: selection.failure.message });
        logStatusChange(request.id, 'pending', 'failed');
        logEvent(request.id, selection.failure.message);
        return { ok: false, request: getRequest(request.id), ...selection.failure };
      }
      // No confident metadata match (formatting, typo, missing release):
      // check the local library before declaring the request failed.
      const fallback = await tryLibraryFallback(adapter, request, title, input.year);
      if (fallback) return fallback;
      patch(request.id, { status: 'failed', message: selection.failure.message });
      logStatusChange(request.id, 'pending', 'failed');
      logEvent(request.id, selection.failure.message);
      return { ok: false, request: getRequest(request.id), ...selection.failure };
    }
    if (getRequest(request.id)?.status === 'cancelled') return { ok: false, request: getRequest(request.id), message: 'Request was cancelled.' };
    const candidate = selection.candidate;
    patch(request.id, { title: candidate.title, year: candidate.year, selectedProviderId: candidate.providerId, metadataProvider: candidate.provider });
    logEvent(request.id, `Matched "${candidate.title}" (${candidate.year ?? 'year unknown'}) via ${candidate.provider}`);
    const existing = requests.find(other => other.id !== request.id && other.mediaType === mediaType &&
      other.metadataProvider === candidate.provider && other.selectedProviderId === candidate.providerId &&
      !['cancelled', 'failed'].includes(other.status));
    if (existing) {
      requests = requests.filter(r => r.id !== request.id);
      persist();
      return { ok: true, request: { ...existing }, message: `A request for "${candidate.title}" is already being tracked.` };
    }
    const library = await adapter.getItems() as unknown as LibraryItem[];
    const matches = library.filter(m => matchesMetadata(m, candidate.provider, candidate.providerId));
    if (matches.length > 1) throw new Error('Multiple library entries have this metadata identity. Resolve the duplicates in the media manager before requesting.');
    const inLibrary = matches[0];
    if (inLibrary?.status === 'available') {
      const message = `"${candidate.title}" is already in your library and available.`;
      patch(request.id, { status: 'failed', message });
      return { ok: false, request: getRequest(request.id), message };
    }
    if (getRequest(request.id)?.status === 'cancelled') return { ok: false, request: getRequest(request.id), message: 'Request was cancelled.' };
    // A film still in cinemas: say so before anything is added, and let the person choose.
    let waitForRelease = false;
    if (mediaType === 'movie' && !inLibrary) {
      if (input.releaseChoice === 'wait') {
        waitForRelease = true;
      } else if (input.releaseChoice !== 'now') {
        // A failed date lookup must never block a request: no warning, request as usual.
        let release: Awaited<ReturnType<RadarrAdapter['releaseInfo']>> = null;
        try { release = await (adapter as unknown as RadarrAdapter).releaseInfo(candidate.providerId); } catch { /* proceed without the warning */ }
        if (release && isStillInCinemas(release)) {
          requests = requests.filter(r => r.id !== request.id);
          persist();
          return { ok: false, code: 'unreleased', message: cinemaNotice(release), release, candidates: [candidate] } as CreateRequestResult;
        }
      }
    }
    if (waitForRelease) patch(request.id, { waitForRelease: true });
    // People without administrator rights may need approval before anything is added.
    if (actor.role === 'user' && rules.approval === 'users') {
      patch(request.id, { status: 'pending', message: 'Waiting for an administrator to approve this request.' });
      logEvent(request.id, 'Sent for approval');
      notify({ type: 'request.pending', role: 'admin', title: `${actor.username} requested ${candidate.title}`, body: 'Waiting for your approval.', link: '/requests' });
      return { ok: true, request: getRequest(request.id), message: `"${candidate.title}" was sent to an administrator for approval.` };
    }
    // Post the resolved identity so the manager adds the exact title. When
    // the title is already tracked as missing, the manager rejects the add
    // with a conflict; the existing entry is then searched instead, which is
    // what requesting an already-monitored title really means.
    const addResult = await adapter.add({ title: candidate.title, year: candidate.year, type: mediaType,
      selectedProviderId: candidate.providerId, qualityProfile: request.qualityProfile, qualityStrict: chosenQuality !== '', ...(waitForRelease ? { wait: true } : {}) });
    // Cancellation during an in-flight call must not be overwritten.
    if (getRequest(request.id)?.status === 'cancelled') return { ok: false, request: getRequest(request.id), message: 'Request was cancelled.' };
    if (!addResult.success) {
      if (inLibrary) {
        logEvent(request.id, `Already tracked in the library; starting a search`);
        const refresh = await adapter.refreshMetadata(inLibrary.id);
        if (getRequest(request.id)?.status === 'cancelled') return { ok: false, request: getRequest(request.id), message: 'Request was cancelled.' };
        if (refresh.success) {
          logStatusChange(request.id, 'pending', 'searching');
          patch(request.id, { status: 'searching', progress: 5, providerId: inLibrary.id });
          return { ok: true, request: getRequest(request.id) };
        }
        patch(request.id, { status: 'failed', message: refresh.message });
        logStatusChange(request.id, 'pending', 'failed');
        logEvent(request.id, refresh.message);
        return { ok: false, request: getRequest(request.id), ...refresh };
      }
      patch(request.id, { status: 'failed', message: addResult.message });
      logStatusChange(request.id, 'pending', 'failed');
      logEvent(request.id, addResult.message);
      return { ok: false, request: getRequest(request.id), ...addResult };
    }
    logStatusChange(request.id, 'pending', 'searching');
    if (waitForRelease) logEvent(request.id, 'Waiting for a proper release; it will be downloaded automatically');
    patch(request.id, {
      status: 'searching', progress: 5, providerId: inLibrary?.id ?? providerIdFrom(addResult),
      ...(waitForRelease ? { message: 'Waiting for a proper release. It will be downloaded automatically once one appears.' } : {}),
      ...(addResult.qualityProfile ? { qualityProfile: addResult.qualityProfile } : {}),
      ...(addResult.rootFolder ? { rootFolder: addResult.rootFolder } : {})
    });
    return { ok: true, request: getRequest(request.id) };
  } catch (error) {
    const message = friendlyServiceError(error, service);
    if (getRequest(request.id)?.status !== 'cancelled') patch(request.id, { status: 'failed', message });
    logEvent(request.id, message);
    return { ok: false, request: getRequest(request.id), message };
  }
}

export async function approveRequest(id: string): Promise<RequestItem | null> {
  const target = getRequest(id);
  if (!target) return null;
  if (target.status !== 'pending' && target.status !== 'failed') return target;
  logEvent(id, 'Retry approved from the requests page');
  try {
    const adapter = adapterFor(target.mediaType);
    const selection = await adapter.resolveCandidate({
      title: target.title, year: target.year, type: target.mediaType, selectedProviderId: target.selectedProviderId
    });
    if ('failure' in selection) throw new Error(selection.failure.message);
    const candidate = selection.candidate;
    patch(id, { selectedProviderId: candidate.providerId, metadataProvider: candidate.provider, year: candidate.year });
    const library = await adapter.getItems() as unknown as LibraryItem[];
    const matches = library.filter(m => matchesMetadata(m, candidate.provider, candidate.providerId));
    if (matches.length > 1) throw new Error('Multiple library entries have this metadata identity. Resolve duplicates before retrying.');
    const inLibrary = matches[0];
    if (getRequest(id)?.status === 'cancelled') return getRequest(id)!;
    if (inLibrary?.status === 'available') {
      patch(id, { status: 'available', progress: 100, providerId: inLibrary.id, message: undefined });
      return getRequest(id)!;
    }
    const addResult = inLibrary ? await adapter.refreshMetadata(inLibrary.id) : await adapter.add({
      title: candidate.title, year: candidate.year, type: target.mediaType,
      selectedProviderId: candidate.providerId, qualityProfile: target.qualityProfile,
      ...(target.waitForRelease ? { wait: true } : {})
    });
    if (getRequest(id)?.status === 'cancelled') return getRequest(id)!;
    if (!addResult.success) throw new Error(addResult.message);
    patch(id, { status: 'searching', progress: 5, message: undefined, providerId: inLibrary?.id ?? providerIdFrom(addResult) });
    if (target.requesterId && target.requesterId !== currentActor().userId) notify({ type: 'request.approved', userId: target.requesterId, title: `${target.title} was approved`, body: 'It is being searched for now.', link: '/requests' });
  } catch (error) {
    if (getRequest(id)?.status !== 'cancelled') patch(id, { status: 'failed', message: friendlyServiceError(error, target.service) });
  }
  return getRequest(id) ?? null;
}

export function cancelRequest(id: string): RequestItem | null {
  const target = getRequest(id);
  if (!target) return null;
  if (target.status === 'available' || target.status === 'cancelled') return target;
  logStatusChange(id, target.status, 'cancelled');
  patch(id, { status: 'cancelled', progress: undefined });
  if (target.status === 'pending' && target.requesterId && target.requesterId !== currentActor().userId) notify({ type: 'request.declined', userId: target.requesterId, title: `${target.title} was declined`, link: '/requests' });
  return getRequest(id) ?? null;
}

/**
 * Remove a request line entirely from the ledger (used for failed or
 * completed entries the user wants cleaned up). The media service is left
 * untouched; only the tracking entry is dropped.
 */
export function deleteRequest(id: string): boolean {
  const before = requests.length;
  requests = requests.filter(r => r.id !== id);
  if (requests.length === before) return false;
  persist();
  return true;
}

async function syncDownload(req: RequestItem, completedMovieId?: string) {
  const linkedId = downloadByRequest.get(req.id);
  if (req.status === 'downloading' || req.status === 'importing') {
    if (linkedId) {
      updateDownload(linkedId, {
        progress: req.progress ?? 0,
        status: req.status === 'importing' ? 'importing' : 'downloading'
      });
      return;
    }
    const download = createDownload({
      title: req.title,
      year: req.year,
      progress: req.progress ?? 0,
      status: req.status === 'importing' ? 'importing' : 'downloading'
    });
    downloadByRequest.set(req.id, download.id);
  } else if (req.status === 'available') {
    if (linkedId) {
      updateDownload(linkedId, { status: 'completed', progress: 100, mediaId: completedMovieId, mediaType: req.mediaType });
    }
  }
}

/**
 * Reconciles in-flight requests against each service's real queue and
 * library state, instead of simulating progress on a timer. Requests are
 * grouped by media type so each connected service is only queried once.
 */
export async function syncRequestsWithServices(): Promise<void> {
  const active = requests.filter(r => ['pending', 'searching', 'downloading', 'importing'].includes(r.status));
  if (!active.length) return;

  const byType = new Map<MediaKind, RequestItem[]>();
  for (const req of active) {
    const list = byType.get(req.mediaType) ?? [];
    list.push(req);
    byType.set(req.mediaType, list);
  }

  for (const [mediaType, reqs] of byType) {
    const adapter = adapterFor(mediaType);
    let library: LibraryItem[] = [];
    let queue: Array<{ title?: string; mediaId?: string; progress?: number; status?: string }> = [];
    try {
      library = (await adapter.getItems()) as unknown as typeof library;
      queue = (await adapter.getQueue()) as unknown as typeof queue;
    } catch {
      continue;
    }

    for (const req of reqs) {
      if (getRequest(req.id)?.status === 'cancelled') continue;
      const before = getRequest(req.id)!.status;
      const libraryMatches = library.filter(m => req.providerId ? m.id === req.providerId :
        req.selectedProviderId && req.metadataProvider ? matchesMetadata(m, req.metadataProvider, req.selectedProviderId) :
        normalizeTitle(m.title) === normalizeTitle(req.title) && m.year === req.year);
      const inLibrary = libraryMatches.length === 1 ? libraryMatches[0] : undefined;
      if (inLibrary && !req.providerId) patch(req.id, { providerId: inLibrary.id });
      if (inLibrary?.status === 'available') {
        logStatusChange(req.id, before, 'available');
        logEvent(req.id, 'Imported into the library and ready to play');
        lastLoggedProgress.delete(req.id);
        patch(req.id, { status: 'available', progress: 100 });
        const mediaId = (inLibrary as unknown as { id: string }).id;
        await syncDownload(getRequest(req.id)!, mediaId);
        continue;
      }
      // Release titles are not identities. Never attach a homonym's progress.
      const localId = req.providerId ?? inLibrary?.id;
      const queued = localId ? queue.find(q => q.mediaId === localId) : undefined;
      if (queued) {
        const status: RequestStatus = queued.status === 'importing' ? 'importing' : 'downloading';
        logStatusChange(req.id, before, status);
        const progress = queued.progress ?? req.progress ?? 0;
        logProgress(req.id, progress);
        patch(req.id, { status, progress, ...(getRequest(req.id)?.message?.startsWith(NOTHING_FOUND_PREFIX) ? { message: undefined } : {}) });
        await syncDownload(getRequest(req.id)!);
      }
    }
  }
}

// A request can sit in "searching" for ever when no source has the title: the
// media services search once when a title is added and afterwards only watch
// for new uploads. Say so after a while, and search again now and then, so a
// request succeeds by itself once a better source is added.
const NOTHING_YET_MS = 15 * 60 * 1000;
const FIRST_RETRY_MS = 30 * 60 * 1000;
const RETRY_MS = 6 * 60 * 60 * 1000;
export const NOTHING_FOUND_PREFIX = 'Nothing found yet';

async function workingSources(): Promise<number | null> {
  try {
    const list = (await getAdapter<ProwlarrAdapter>('prowlarr').listIndexers()).filter(i => i.enabled);
    return list.filter(i => !i.failingUntil).length;
  } catch {
    return null;
  }
}

export async function reviewStuckSearches(now = Date.now()): Promise<void> {
  const stuck = requests.filter(r => r.status === 'searching' && r.providerId && !r.waitForRelease);
  if (!stuck.length) return;
  let sources: number | null | undefined;
  for (const req of stuck) {
    const since = Date.parse(req.searchedAt ?? req.createdAt);
    if (!Number.isFinite(since)) continue;
    const waited = now - since;
    if (waited >= NOTHING_YET_MS && !req.message?.startsWith(NOTHING_FOUND_PREFIX)) {
      sources ??= await workingSources();
      const message = sources === 0
        ? `${NOTHING_FOUND_PREFIX}: none of your places to search is answering. Add one under Settings > Indexers. It is searched again automatically.`
        : `${NOTHING_FOUND_PREFIX}: none of your places to search has it. Add more under Settings > Indexers. It is searched again automatically every 6 hours.`;
      patch(req.id, { message });
      logEvent(req.id, 'No source has it yet');
    }
    if (waited >= ((req.searches ?? 0) === 0 ? FIRST_RETRY_MS : RETRY_MS)) {
      const result = await retryTitle(req.providerId!).catch(() => ({ success: false, message: '' }));
      patch(req.id, { searchedAt: new Date(now).toISOString(), searches: (req.searches ?? 0) + 1 });
      if (result.success) logEvent(req.id, 'Searched again automatically');
    }
  }
}

export function startRequestSync(intervalMs = 15000): NodeJS.Timeout {
  let reviewing = false;
  return setInterval(() => {
    void syncRequestsWithServices();
    if (reviewing) return;
    reviewing = true;
    void reviewStuckSearches().finally(() => { reviewing = false; });
  }, intervalMs);
}
