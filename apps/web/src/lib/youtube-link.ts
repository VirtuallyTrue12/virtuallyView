/**
 * The video id in whatever someone pasted: a watch link, a short link, a Shorts, live or embed link,
 * or a music.youtube.com link. Playlist links without a video, and anything else, give null.
 */
export function youtubeIdFromText(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t) && !/^https?:\/\//i.test(t)) return null;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  const ok = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
  if (host === 'youtu.be') return ok(url.pathname.split('/')[1]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = ok(url.searchParams.get('v'));
    if (v) return v;
    const m = /^\/(?:shorts|live|embed|v)\/([^/?]+)/.exec(url.pathname);
    return ok(m?.[1]);
  }
  return null;
}
