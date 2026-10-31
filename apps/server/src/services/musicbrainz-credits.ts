/**
 * Song credits (writers, producers, performers) from MusicBrainz, for one release.
 * Results are cached in SQLite, and requests go out at most once per second, as
 * MusicBrainz asks of anyone using its public API.
 */
import { get as dbGet, run as dbRun } from '../db/app-db.js';
import { outboundFetch } from './outbound.js';

export interface Credits {
  writers: string[];
  producers: string[];
  performers: string[];
}

export interface TrackCredits extends Credits {
  position: number;
  title: string;
}

export interface ReleaseCredits extends Credits {
  tracks: TrackCredits[];
}

interface Relation {
  type?: string;
  artist?: { name?: string };
  work?: { relations?: Relation[] };
}

interface MbRecording {
  title?: string;
  'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>;
  relations?: Relation[];
}

interface MbTrack {
  position?: number;
  title?: string;
  recording?: MbRecording;
}

interface MbRelease {
  media?: Array<{ tracks?: MbTrack[] }>;
}

const WRITER_TYPES = new Set(['composer', 'writer', 'lyricist', 'librettist']);
const PRODUCER_TYPES = new Set(['producer', 'co-producer', 'executive producer']);
const PERFORMER_TYPES = new Set(['vocal', 'instrument', 'performer', 'conductor', 'chorus master', 'orchestrator']);

const uniq = (names: string[]): string[] => [...new Set(names.map(n => n.trim()).filter(Boolean))];

/** Credits for one recording, read from the recording's relations (and the works it performs). */
function recordingCredits(recording: MbRecording | undefined): Credits {
  const writers: string[] = [];
  const producers: string[] = [];
  const performers: string[] = (recording?.['artist-credit'] ?? []).map(c => c.name ?? c.artist?.name ?? '');
  for (const rel of recording?.relations ?? []) {
    const type = (rel.type ?? '').toLowerCase();
    const name = rel.artist?.name ?? '';
    if (PRODUCER_TYPES.has(type) && name) producers.push(name);
    if (PERFORMER_TYPES.has(type) && name) performers.push(name);
    // Writers sit on the work the recording is a performance of.
    for (const workRel of rel.work?.relations ?? []) {
      const workType = (workRel.type ?? '').toLowerCase();
      if (WRITER_TYPES.has(workType) && workRel.artist?.name) writers.push(workRel.artist.name);
    }
  }
  return { writers: uniq(writers), producers: uniq(producers), performers: uniq(performers) };
}

/**
 * Turn a MusicBrainz release (with recordings, artist credits and relations) into
 * credits per track and for the whole album. Returns null when the release has no tracks.
 */
export function parseReleaseCredits(json: unknown): ReleaseCredits | null {
  const release = (json ?? {}) as MbRelease;
  const tracks: TrackCredits[] = [];
  for (const medium of release.media ?? []) {
    for (const track of medium.tracks ?? []) {
      const title = track.title ?? track.recording?.title ?? '';
      if (!title) continue;
      const position = Number(track.position) || tracks.length + 1;
      tracks.push({ position, title, ...recordingCredits(track.recording) });
    }
  }
  if (!tracks.length) return null;
  return {
    tracks,
    writers: uniq(tracks.flatMap(t => t.writers)),
    producers: uniq(tracks.flatMap(t => t.producers)),
    performers: uniq(tracks.flatMap(t => t.performers))
  };
}

export const CREDITS_URL_BASE = 'https://musicbrainz.org/ws/2/release/';
export const MB_USER_AGENT = 'virtuallyView/1.0 (self-hosted)';
const INCLUDES = 'recordings+artist-credits+recording-level-rels+work-rels+work-level-rels';
const MIN_GAP_MS = 1000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

let nextSlot = 0;
/** Waits so that MusicBrainz sees at most one request per second from this server. */
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + MIN_GAP_MS;
  if (start > now) await new Promise(resolve => setTimeout(resolve, start - now));
}

export class CreditsUnavailable extends Error {}

/**
 * Credits for a MusicBrainz release id. Null means MusicBrainz has no such release.
 * Throws CreditsUnavailable when MusicBrainz cannot be reached, so the caller can say so.
 */
export async function fetchReleaseCredits(releaseId: string): Promise<ReleaseCredits | null> {
  const cached = dbGet<{ payload: string; fetched_at: string }>('SELECT payload, fetched_at FROM musicbrainz_credits WHERE release_id = ?', releaseId);
  if (cached && Date.now() - Date.parse(cached.fetched_at) < TTL_MS) {
    return JSON.parse(cached.payload) as ReleaseCredits | null;
  }
  await rateLimit();
  let res: Response;
  try {
    res = await outboundFetch(`${CREDITS_URL_BASE}${encodeURIComponent(releaseId)}?inc=${INCLUDES}&fmt=json`, {
      headers: { 'User-Agent': MB_USER_AGENT, Accept: 'application/json' },
      timeoutMs: 12000
    });
  } catch {
    throw new CreditsUnavailable('MusicBrainz could not be reached.');
  }
  if (res.status === 404) {
    storeCredits(releaseId, null);
    return null;
  }
  if (!res.ok) throw new CreditsUnavailable(`MusicBrainz answered ${res.status}.`);
  const credits = parseReleaseCredits(await res.json());
  storeCredits(releaseId, credits);
  return credits;
}

function storeCredits(releaseId: string, credits: ReleaseCredits | null): void {
  dbRun(
    'INSERT INTO musicbrainz_credits (release_id, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(release_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at',
    releaseId, JSON.stringify(credits), new Date().toISOString()
  );
}
