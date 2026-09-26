import type { MediaKind, RequestItem } from './api';
import { getPreferredQuality } from './quality';

export interface RequestCandidate {
  provider: 'tmdb' | 'tvdb' | 'musicbrainz';
  providerId: string;
  title: string;
  year?: number;
  type: MediaKind;
  overview?: string;
  poster?: string;
  popularity?: number;
}

export interface SelectionResult {
  ok: boolean;
  request?: RequestItem;
  message?: string;
  code?: string;
  candidates?: RequestCandidate[];
}

async function fetchSelection<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json();
  if (response.status === 401) window.dispatchEvent(new CustomEvent('virtuallyview:auth-required'));
  if (!response.ok) throw new Error(body?.message ?? `Request failed (${response.status})`);
  return body as T;
}

export function lookupRequestCandidates(title: string, mediaType: MediaKind): Promise<{ candidates: RequestCandidate[] }> {
  return fetchSelection(`/api/requests/candidates?${new URLSearchParams({ title, mediaType })}`);
}

export function confirmRequestCandidate(candidate: RequestCandidate): Promise<SelectionResult> {
  return fetchSelection('/api/requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: candidate.title, year: candidate.year, mediaType: candidate.type, selectedProviderId: candidate.providerId, ...(candidate.poster ? { poster: candidate.poster } : {}) })
  });
}

export type RequestOutcome =
  | { kind: 'ok'; message: string; request?: RequestItem }
  | { kind: 'ambiguous'; message: string; candidates: RequestCandidate[] }
  | { kind: 'unreleased'; message: string; candidate: RequestCandidate }
  | { kind: 'error'; message: string };

/** Create a request and classify the answer; the 409 candidate list is kept. */
export async function submitRequest(body: {
  title: string; year?: number; mediaType: MediaKind; selectedProviderId?: string; qualityProfile?: string; poster?: string;
  /** For a film with no home release yet: wait for a proper copy, or take a camera copy now. */
  releaseChoice?: 'wait' | 'now';
}): Promise<RequestOutcome> {
  try {
    const quality = body.qualityProfile ?? getPreferredQuality(body.mediaType);
    const response = await fetch('/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: body.title, mediaType: body.mediaType,
        ...(body.year ? { year: body.year } : {}),
        ...(body.selectedProviderId ? { selectedProviderId: body.selectedProviderId } : {}),
        ...(quality ? { qualityProfile: quality } : {}),
        ...(body.releaseChoice ? { releaseChoice: body.releaseChoice } : {}),
        ...(body.poster ? { poster: body.poster } : {})
      })
    });
    if (response.status === 401) window.dispatchEvent(new CustomEvent('virtuallyview:auth-required'));
    const data = await response.json().catch(() => ({})) as SelectionResult;
    if (response.ok && data.ok !== false && data.request?.status !== 'failed') {
      return { kind: 'ok', message: data.message ?? `Requested "${data.request?.title ?? body.title}". Track it on the Requests page.`, ...(data.request ? { request: data.request } : {}) };
    }
    const message = data.message ?? data.request?.message ?? `Request failed (${response.status}).`;
    if (data.code === 'unreleased' && data.candidates?.[0]) return { kind: 'unreleased', message, candidate: data.candidates[0] };
    if (data.code === 'ambiguous') {
      let candidates = data.candidates ?? [];
      if (candidates.length === 0) {
        candidates = (await lookupRequestCandidates(body.title, body.mediaType).catch(() => ({ candidates: [] }))).candidates;
      }
      if (candidates.length > 0) return { kind: 'ambiguous', message, candidates };
    }
    return { kind: 'error', message };
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
}
