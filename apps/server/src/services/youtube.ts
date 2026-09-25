import { readFileSync } from 'node:fs';
import path from 'node:path';
import { artistGuesses, classifyMusicVideo, resolveArtist, type ArtistFolder, type FilerDeps, type VideoKind } from './music-videos.js';

/**
 * Concerts and music videos from YouTube, through the optional worker service
 * (docker compose --profile youtube up -d). This side only decides who the
 * artist is and where the file belongs; the worker does the downloading.
 */

export interface YoutubeResult {
  id: string;
  title: string;
  channel: string;
  durationSeconds: number;
  views: number;
  thumbnail: string;
  /** Best guess at the artist from the title, or empty. */
  artistGuess: string;
  kind: VideoKind;
}

export interface YoutubeJob {
  id: string; videoId: string; title: string; dir: string;
  status: 'queued' | 'downloading' | 'merging' | 'done' | 'error' | 'cancelled';
  percent: number; eta?: string; speed?: string; file?: string; error?: string;
  createdAt: string; startedAt?: string; finishedAt?: string;
}

function config(): { url: string; token: string } | null {
  const url = process.env.YTDLP_URL;
  if (!url) return null;
  try {
    const file = process.env.YTDLP_TOKEN_FILE;
    const token = file ? readFileSync(file, 'utf8').trim() : (process.env.YTDLP_TOKEN ?? '');
    return token ? { url: url.replace(/\/$/, ''), token } : null;
  } catch { return null; }
}

async function call<T>(method: 'GET' | 'POST', route: string, body?: unknown, timeoutMs = 70_000): Promise<T> {
  const cfg = config();
  if (!cfg) throw new WorkerOff();
  let res: Response;
  try {
    res = await fetch(`${cfg.url}${route}`, {
      method, headers: { Authorization: `Bearer ${cfg.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs)
    });
  } catch { throw new WorkerOff(); }
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `The YouTube service answered ${res.status}.`);
  return data;
}

/** The YouTube service is not running (the profile is off) or cannot be reached. */
export class WorkerOff extends Error {
  constructor() { super('YouTube downloads are not turned on. Run: docker compose --profile youtube up -d'); }
}

export async function youtubeAvailable(): Promise<boolean> {
  try { await call('GET', '/health', undefined, 3000); return true; } catch { return false; }
}

export async function searchYoutube(query: string): Promise<YoutubeResult[]> {
  const { results } = await call<{ results: Array<Omit<YoutubeResult, 'artistGuess' | 'kind'>> }>('POST', '/search', { q: query });
  return results.map(r => ({
    ...r,
    artistGuess: artistGuesses(r.title)[0] ?? '',
    // Long uploads are shows; short ones are clips. The title's own words win.
    kind: classifyMusicVideo(r.title) ?? (r.durationSeconds >= 1500 ? 'Concerts' : 'Videos')
  }));
}

export async function youtubeJobs(): Promise<YoutubeJob[]> {
  return (await call<{ jobs: YoutubeJob[] }>('GET', '/jobs', undefined, 5000)).jobs;
}

export async function cancelYoutubeJob(id: string): Promise<void> {
  await call('POST', `/jobs/${encodeURIComponent(id)}/cancel`, {}, 5000);
}

/** Works out the artist (creating them when new), then asks the worker to save the video in their Concerts or Videos folder. */
export async function downloadFromYoutube(
  input: { id: string; title: string; artist?: string; kind?: VideoKind },
  deps: Pick<FilerDeps, 'lidarr'>
): Promise<{ job: YoutubeJob; artist: ArtistFolder; created: boolean; kind: VideoKind } | { failure: string }> {
  const guesses = input.artist?.trim() ? [input.artist.trim()] : artistGuesses(input.title);
  const kind = input.kind ?? classifyMusicVideo(input.title) ?? 'Videos';
  const resolved = await resolveArtist(guesses, deps as FilerDeps);
  if ('failure' in resolved) return { failure: resolved.failure };
  const dir = path.posix.join(resolved.artist.path.replace(/\\/g, '/'), kind);
  const job = await call<YoutubeJob>('POST', '/download', { id: input.id, dir, title: input.title }, 15_000);
  return { job, artist: resolved.artist, created: resolved.created, kind };
}
