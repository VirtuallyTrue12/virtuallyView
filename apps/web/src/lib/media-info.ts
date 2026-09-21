import type { MediaPlaybackInfo } from './api';

const names = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; } })();
export const languageName = (code: string) => {
  if (!code || code === 'und') return 'Unknown';
  try { return names?.of(code) ?? code; } catch { return code; }
};

export const audioLabels = (info: MediaPlaybackInfo | null) =>
  (info?.audioTracks ?? []).map(t => ({
    index: t.index,
    label: `${t.title || languageName(t.language)} · ${t.codec.toUpperCase()}${t.channels ? ` ${t.channels === 6 ? '5.1' : t.channels === 8 ? '7.1' : t.channels === 2 ? 'stereo' : `${t.channels}ch`}` : ''}`
  }));

export const resolutionLabel = (height?: number | null) =>
  !height ? '' : height >= 2000 ? '4K' : height >= 1000 ? '1080p' : height >= 700 ? '720p' : height >= 460 ? '480p' : `${height}p`;

export const formatBytes = (bytes?: number | null) =>
  !bytes ? '' : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

/** Picture-based subtitle streams, numbered among subtitle streams the way the server expects. */
export const imageSubtitleLabels = (info: MediaPlaybackInfo | null) =>
  (info?.subtitleStreams ?? []).filter(t => !t.text).map(t => ({ index: t.index, label: t.title || languageName(t.language) }));
