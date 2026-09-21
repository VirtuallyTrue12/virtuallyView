// Release names arrive as scene tags: "Mr Robot S04E11 eXit 1080p AMZN WEB-DL DDP5 1 H 264-FLUX".
// People want "Mr Robot S04E11 eXit". These helpers clean the name for display and
// pull the useful technical bits out as a short label, without touching the file on disk.

const NOISE = [
  '2160p', '1080p', '1080i', '720p', '576p', '480p', '4k', 'uhd', 'hdr10\\+?', 'hdr', 'dv', 'dovi', 'sdr',
  'web[- .]?dl', 'webrip', 'web', 'bluray', 'blu[- .]?ray', 'brrip', 'bdrip', 'bdremux', 'remux', 'hdtv', 'dvdrip', 'dvd', 'hdcam', 'cam', 'telesync', 'ts',
  'x264', 'x265', 'h[ .]?264', 'h[ .]?265', 'hevc', 'avc', 'xvid', 'av1', '10bit', '8bit',
  'aac(?:[ .]?[257][ .]?[01])?', 'ac3', 'eac3', 'dts(?:-?hd)?(?:[ .]?ma)?', 'truehd', 'atmos', 'flac', 'mp3', 'ddp?[ .]?[257][ .]?[01]?', 'dd[ .]?[257][ .]?[01]?',
  '[257][ .][01]', '[257]\\.[01]ch', '6ch', '2ch',
  'amzn', 'nf', 'dsnp', 'hulu', 'hmax', 'atvp', 'pcok', 'repack', 'proper', 'internal', 'extended', 'unrated', 'multi', 'dual[- .]?audio',
  'hi[- .]?res', '24[- .]?bit', '16[- .]?bit', '24[- .]?48', 'vbr', 'cbr', '320(?:kbps)?', 'v0', 'lossless',
  'complete', '2cd', '3cd', 'cd', 'ost', 'deluxe(?: edition| version)?'
];
const NOISE_RE = new RegExp(`(?:^|[\\s.\\-_])(?:${NOISE.join('|')})(?=$|[\\s.\\-_])`, 'gi');

/** "Show.Name.S01E02.Title.1080p.WEB-DL-GROUP" to "Show Name S01E02 Title". */
export function cleanReleaseName(raw: string): string {
  let name = (raw ?? '').trim();
  if (!name) return '';
  name = name.replace(/\.(mkv|mp4|avi|m4v|mov|flac|mp3|m4a|srt|ass|vtt)$/i, '');
  // Bracketed tags are release metadata unless they hold a year.
  name = name.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ');
  name = name.replace(/\((?!\s*(?:19|20)\d{2}\s*\))[^)]*\)/g, ' ');
  name = name.replace(/[⭐️★]/g, ' ');
  // Dots and underscores are word separators, but keep "S01E02" intact.
  name = name.replace(/[._]+/g, ' ');
  // Cut everything from the first quality token onward when a title precedes it.
  const cut = name.search(/\s(?:2160p|1080p|1080i|720p|576p|480p|4k)\b/i);
  if (cut > 3) name = name.slice(0, cut);
  name = name.replace(NOISE_RE, ' ');
  // Trailing release group after a dash: "-FLUX", "- Sc4r3cr0w".
  name = name.replace(/\s*-\s*[A-Za-z0-9]+\s*$/, m => (/\s-\s[A-Za-z]{2,}\s[A-Za-z]/.test(m) ? m : ''));
  name = name.replace(/\s{2,}/g, ' ').replace(/^[\s\-\u2013]+|[\s\-\u2013]+$/g, '').trim();
  return name || raw.trim();
}

/** A short "1080p WEB-DL" or "FLAC 24-bit" label from a release name, or empty. */
export function releaseQualityLabel(raw: string): string {
  const s = raw ?? '';
  const res = /\b(2160p|4k|1080p|720p|480p)\b/i.exec(s)?.[1]?.toLowerCase();
  const src = /\b(remux|blu[- .]?ray|web[- .]?dl|webrip|hdtv|dvdrip|cam|telesync)\b/i.exec(s)?.[1]?.replace(/[- .]/g, '-');
  const audio = /\b(flac|mp3|aac|alac|dsd)\b/i.exec(s)?.[1]?.toUpperCase();
  const depth = /\b(24)[- .]?bit\b/i.exec(s) ? '24-bit' : '';
  return [res, src, audio, depth].filter(Boolean).join(' ');
}
