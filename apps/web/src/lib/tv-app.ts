/**
 * Hands playback to the Android TV app. The app plays the direct file in the TV's own
 * player (HEVC, HDR, surround sound), and the server's converted copy is the fallback.
 * Links are signed with a short-lived token, so the native player needs no login cookie for video.
 */
import type { SubtitleTrack } from '../components/media/PlyrPlayer';

declare global {
  interface Window {
    VVNative?: { play(json: string): void };
  }
}

export interface TvPlayRequest {
  /** Direct file path, e.g. /api/stream/<id> or /api/stream/episode/<id>. */
  path: string;
  /** Converted copy used only if the TV cannot decode the file. */
  transcodePath: string;
  title: string;
  subtitle?: string;
  startSeconds: number;
  subtitles: SubtitleTrack[];
  mediaType: 'movie' | 'episode';
  mediaId: string;
  seriesId?: string;
  /** Length from the server's media info, used when the TV player cannot tell. */
  durationSeconds?: number | null;
  /** Page to return to when the TV player closes, so the progress shows up. */
  returnPath: string;
}

/** An absolute URL on this server with a signed token for that one path. */
async function signedUrl(path: string): Promise<string> {
  const [pathname = '', query = ''] = path.split('?');
  const res = await fetch('/api/stream-token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: pathname }),
  });
  if (!res.ok) throw new Error('Could not sign the playback link.');
  const { token } = (await res.json()) as { token: string };
  const url = `${pathname}?${query ? `${query}&` : ''}st=${encodeURIComponent(token)}`;
  return new URL(url, window.location.origin).href;
}

/** Sends one title to the TV app's player. Throws when the bridge or signing fails. */
export async function playInTvApp(req: TvPlayRequest): Promise<void> {
  const native = window.VVNative;
  if (!native) throw new Error('The TV app is not ready.');
  // The converted copy starts at the resume point itself, because it cannot seek.
  const start = Math.max(0, Math.floor(req.startSeconds));
  const payload = {
    url: await signedUrl(req.path),
    transcodeUrl: await signedUrl(`${req.transcodePath}${start ? `?start=${start}` : ''}`),
    transcodeOffset: start,
    title: req.title,
    subtitle: req.subtitle ?? '',
    startSeconds: start,
    subtitles: await Promise.all(req.subtitles.map(async t => ({
      url: await signedUrl(t.src),
      label: t.label,
      lang: t.srclang,
    }))),
    mediaType: req.mediaType,
    mediaId: req.mediaId,
    seriesId: req.seriesId ?? null,
    durationSeconds: req.durationSeconds ?? 0,
    returnPath: req.returnPath,
    serverUrl: window.location.origin,
  };
  native.play(JSON.stringify(payload));
}
