import type { MediaPlaybackInfo } from './api';

const names = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; } })();
export const languageName = (code: string) => {
  if (!code || code === 'und') return 'Unknown';
  try { return names?.of(code) ?? code; } catch { return code; }
};

// ffprobe reports languages as three-letter codes, some of them the old "bibliographic" ones that Intl does not know.
const BIBLIOGRAPHIC: Record<string, string> = {
  alb: 'sqi', arm: 'hye', baq: 'eus', bur: 'mya', chi: 'zho', cze: 'ces', dut: 'nld', fre: 'fra', geo: 'kat', ger: 'deu', gre: 'ell',
  ice: 'isl', mac: 'mkd', mao: 'mri', may: 'msa', per: 'fas', rum: 'ron', slo: 'slk', tib: 'bod', wel: 'cym'
};

const CODEC_NAMES: Record<string, string> = {
  ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD', dts: 'DTS', aac: 'AAC', opus: 'Opus', flac: 'FLAC',
  mp3: 'MP3', vorbis: 'Vorbis', alac: 'ALAC', pcm_s16le: 'PCM', pcm_s24le: 'PCM'
};

/** "hin" and "ger" to "Hindi" and "German". Empty when the code says nothing (und, mis, zxx). */
export function languageFromCode(code: string): string {
  const c = (code ?? '').toLowerCase().trim();
  if (!c || ['und', 'mis', 'mul', 'zxx', 'unk'].includes(c)) return '';
  try { return names?.of(BIBLIOGRAPHIC[c] ?? c) ?? ''; } catch { return ''; }
}

const channelName = (channels: number | null) =>
  !channels ? '' : channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : channels === 6 ? '5.1' : channels === 8 ? '7.1' : `${channels} channels`;

/** A title tag is useful only when it says something about the track. Release groups ("KIN") and codec names are noise. */
function usefulNote(title: string): string {
  const t = (title ?? '').trim();
  if (/commentary/i.test(t)) return 'Commentary';
  if (/descriptive|audio description|\bAD\b|visually impaired/i.test(t)) return 'Audio description';
  if (/\boriginal\b/i.test(t)) return 'Original';
  if (/\bdub(bed)?\b/i.test(t)) return 'Dubbed';
  if (/\bdirector/i.test(t)) return 'Director';
  return '';
}

const COMMON_LANGUAGES = ['en', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'ur', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'tr', 'pl', 'nl', 'sv', 'da', 'no', 'fi', 'el', 'he', 'th', 'vi', 'id', 'cs', 'hu', 'ro', 'uk', 'fa'];

/** A language named in the title tag, for files whose language tag is missing ("Hindi 5.1"). */
function languageFromTitle(title: string): string {
  const t = (title ?? '').toLowerCase();
  if (!t) return '';
  for (const code of COMMON_LANGUAGES) {
    const name = names?.of(code);
    if (name && new RegExp(`\\b${name.toLowerCase()}\\b`).test(t)) return name;
  }
  return '';
}

/** "English · 5.1 · Dolby Digital", "Hindi · Stereo · AAC", with " (Commentary)" and so on when the file says so. Tracks that would read the same are numbered. */
export const audioLabels = (info: MediaPlaybackInfo | null) => {
  const tracks = info?.audioTracks ?? [];
  const labels = tracks.map((t, position) => {
    const language = languageFromCode(t.language) || languageFromTitle(t.title) || (tracks.length > 1 ? `Track ${position + 1}` : 'Audio');
    const note = usefulNote(t.title);
    const parts = [language + (note ? ` (${note})` : ''), channelName(t.channels), CODEC_NAMES[t.codec.toLowerCase()] ?? t.codec.toUpperCase()].filter(Boolean);
    return parts.join(' \u00b7 ');
  });
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const l of labels) total.set(l, (total.get(l) ?? 0) + 1);
  return tracks.map((t, i) => {
    const l = labels[i]!;
    if ((total.get(l) ?? 0) < 2) return { index: t.index, label: l };
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return { index: t.index, label: `${l} (${n})` };
  });
};

export const resolutionLabel = (height?: number | null) =>
  !height ? '' : height >= 2000 ? '4K' : height >= 1000 ? '1080p' : height >= 700 ? '720p' : height >= 460 ? '480p' : `${height}p`;

export const formatBytes = (bytes?: number | null) =>
  !bytes ? '' : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

/** Picture-based subtitle streams, numbered among subtitle streams the way the server expects. */
export const imageSubtitleLabels = (info: MediaPlaybackInfo | null) =>
  (info?.subtitleStreams ?? []).filter(t => !t.text).map(t => ({ index: t.index, label: languageFromCode(t.language) || t.title || 'Subtitles' }));
