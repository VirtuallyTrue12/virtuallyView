import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Browser playback support is narrower than what a media server typically
 * stores: MKV containers, HEVC/H.265 video and DTS/AC3 audio all fail to decode
 * in a normal browser. When ffmpeg is available we transcode those files to
 * fragmented MP4 (H.264/AAC) on the fly instead of showing a dead player.
 */
const BROWSER_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora']);
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const BROWSER_CONTAINERS = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'ogg']);

export interface AudioTrack { index: number; codec: string; language: string; title: string; channels: number | null }
export interface SubtitleStream { index: number; codec: string; language: string; title: string; text: boolean }

export interface Chapter { start: number; end: number; title: string }

export interface MediaProbe {
  playable: boolean;
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  durationSeconds: number | null;
  reason?: string;
  width?: number | null;
  height?: number | null;
  bitrate?: number | null;
  sizeBytes?: number | null;
  /** True when the video is 8-bit H.264 and can be remuxed without re-encoding. */
  videoCopyOk?: boolean;
  audioTracks?: AudioTrack[];
  subtitleStreams?: SubtitleStream[];
  chapters?: Chapter[];
}

// Subtitle codecs ffmpeg can convert to WebVTT; bitmap subs (PGS, VobSub) cannot.
const TEXT_SUBS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);

export type Binary = 'ffmpeg' | 'ffprobe';

function which(bin: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, bin);
    try {
      if (existsSync(full)) return full;
    } catch {
      // skip unreadable PATH entries
    }
  }
  return null;
}

function candidatePaths(name: Binary): string[] {
  const explicit = name === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  const list: string[] = [];
  if (explicit) list.push(explicit);
  list.push(path.join(homedir(), '.local', 'bin', name));
  list.push(`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/opt/homebrew/bin/${name}`);
  return list;
}

export function resolveBinary(name: Binary): string | null {
  for (const candidate of candidatePaths(name)) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // keep looking
    }
  }
  return which(name);
}

export function ffmpegAvailable(): boolean {
  return resolveBinary('ffmpeg') !== null;
}

const probeCache = new Map<string, { key: string; value: MediaProbe }>();

function inferFromExtension(filePath: string): MediaProbe {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const playable = BROWSER_CONTAINERS.has(ext);
  return {
    playable,
    container: ext || 'unknown',
    videoCodec: null,
    audioCodec: null,
    durationSeconds: null,
    reason: playable ? undefined : `this .${ext || 'unknown'} file needs conversion`
  };
}

type ProbeStreams = Pick<MediaProbe, 'videoCodec' | 'audioCodec' | 'durationSeconds' | 'width' | 'height' | 'bitrate' | 'videoCopyOk' | 'audioTracks' | 'subtitleStreams' | 'chapters'>;

function runProbe(ffprobe: string, filePath: string): Promise<ProbeStreams | null> {
  return new Promise(resolve => {
    let stdout = '';
    let settled = false;
    const finish = (value: ProbeStreams | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const child = spawn(ffprobe, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      '-show_chapters',
      filePath
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, 8000);
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.on('error', () => { clearTimeout(timer); finish(null); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        type RawStream = {
          codec_type?: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; profile?: string; channels?: number;
          tags?: { language?: string; title?: string }; disposition?: { attached_pic?: number };
        };
        const parsed = JSON.parse(stdout) as { streams?: RawStream[]; format?: { duration?: string; bit_rate?: string }; chapters?: Array<{ start_time?: string; end_time?: string; tags?: { title?: string } }> };
        const streams = parsed.streams ?? [];
        const video = streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
        const audio = streams.filter(stream => stream.codec_type === 'audio');
        const subs = streams.filter(stream => stream.codec_type === 'subtitle');
        const duration = parsed.format?.duration ? Number(parsed.format.duration) : NaN;
        const bitrate = parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : NaN;
        finish({
          videoCodec: video?.codec_name ?? null,
          audioCodec: audio[0]?.codec_name ?? null,
          durationSeconds: Number.isFinite(duration) ? duration : null,
          width: video?.width ?? null,
          height: video?.height ?? null,
          bitrate: Number.isFinite(bitrate) ? bitrate : null,
          videoCopyOk: video?.codec_name === 'h264' && video.pix_fmt === 'yuv420p',
          chapters: (parsed.chapters ?? []).map((c, i) => ({ start: Number(c.start_time) || 0, end: Number(c.end_time) || 0, title: c.tags?.title ?? `Chapter ${i + 1}` })).filter(c => c.end > c.start),
          audioTracks: audio.map((a, index) => ({
            index, codec: a.codec_name ?? 'unknown', language: a.tags?.language ?? 'und',
            title: a.tags?.title ?? '', channels: a.channels ?? null
          })),
          subtitleStreams: subs.map((sub, index) => ({
            index, codec: sub.codec_name ?? 'unknown', language: sub.tags?.language ?? 'und',
            title: sub.tags?.title ?? '', text: TEXT_SUBS.has(sub.codec_name ?? '')
          }))
        });
      } catch {
        finish(null);
      }
    });
  });
}

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  let cacheKey = '';
  let sizeBytes: number | null = null;
  try {
    const stat = statSync(filePath);
    cacheKey = `${stat.size}:${stat.mtimeMs}`;
    sizeBytes = stat.size;
  } catch {
    return { playable: false, container: 'unknown', videoCodec: null, audioCodec: null, durationSeconds: null, reason: 'file is not readable' };
  }
  const cached = probeCache.get(filePath);
  if (cached && cached.key === cacheKey) return cached.value;

  const ext = path.extname(filePath).slice(1).toLowerCase();
  const base = inferFromExtension(filePath);
  const ffprobe = resolveBinary('ffprobe');
  let value: MediaProbe = base;
  if (ffprobe) {
    const streams = await runProbe(ffprobe, filePath);
    if (streams) {
      const videoOk = !streams.videoCodec || BROWSER_VIDEO.has(streams.videoCodec);
      const audioOk = !streams.audioCodec || BROWSER_AUDIO.has(streams.audioCodec);
      const containerOk = BROWSER_CONTAINERS.has(ext);
      const playable = containerOk && videoOk && audioOk;
      let reason: string | undefined;
      if (!containerOk) reason = `the .${ext || 'unknown'} container needs conversion`;
      else if (!videoOk) reason = `the ${streams.videoCodec?.toUpperCase()} video needs conversion`;
      else if (!audioOk) reason = `the ${streams.audioCodec?.toUpperCase()} audio needs conversion`;
      value = {
        playable,
        container: ext || 'unknown',
        videoCodec: streams.videoCodec,
        audioCodec: streams.audioCodec,
        durationSeconds: streams.durationSeconds,
        reason,
        width: streams.width ?? null,
        height: streams.height ?? null,
        bitrate: streams.bitrate ?? null,
        sizeBytes,
        videoCopyOk: streams.videoCopyOk === true,
        audioTracks: streams.audioTracks ?? [],
        subtitleStreams: streams.subtitleStreams ?? [],
        chapters: streams.chapters ?? []
      };
    }
  }
  probeCache.set(filePath, { key: cacheKey, value });
  return value;
}

export interface TranscodeOptions {
  /** Zero-based audio track (among audio streams). */
  audio?: number;
  /** Target height in pixels; 0/undefined keeps the source size. */
  height?: number;
  /** Source is 8-bit H.264: remux the video instead of re-encoding (fast, lossless). */
  copyVideo?: boolean;
  /** Zero-based image subtitle stream (PGS, VobSub) to draw onto the picture. Forces a re-encode. */
  burn?: number;
}

/** The `-map`/`-c:v`/`-c:a` portion shared by every output container (progressive MP4 or HLS). */
function encodeArgs(options: TranscodeOptions): string[] {
  const args: string[] = [];
  const audio = Number.isInteger(options.audio) && (options.audio ?? 0) >= 0 ? options.audio : 0;
  const burn = Number.isInteger(options.burn) && (options.burn ?? -1) >= 0 ? options.burn : undefined;
  const scale = options.height && options.height > 0;
  if (burn !== undefined) {
    const overlay = `[0:v:0][0:s:${burn}]overlay${scale ? `,scale=-2:${Math.round(options.height as number)}` : ''}[v]`;
    args.push('-filter_complex', overlay, '-map', '[v]', '-map', `0:a:${audio}?`);
  } else {
    args.push('-map', '0:v:0', '-map', `0:a:${audio}?`);
  }
  // Only video and audio are mapped above, but ffmpeg still copies the source's chapter markers into a
  // separate text track by default. A release with many auto-generated scene-chapter markers (common in
  // WEBDL rips) then produces a THIRD, unmapped track in the fragmented output, which some browsers'
  // stricter demuxers refuse outright ("could not decode the video") even though the video/audio are
  // perfectly fine on their own. Nothing here uses chapter markers from the transcoded stream itself
  // (the player reads them separately, from ffprobe on the source file), so they are dropped.
  args.push('-map_chapters', '-1');
  if (options.copyVideo && !scale && burn === undefined) {
    args.push('-c:v', 'copy');
  } else {
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', scale ? '25' : '23',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      // A source with a long keyframe interval (common in HEVC releases) held several seconds of frames
      // before a fragment (or HLS segment) could close, so the browser received video in bursts with a
      // stall in between. A keyframe every 2 seconds, on a wall-clock schedule rather than the source's
      // own GOP, fixes that, and also sets the pace of the HLS segments below.
      '-force_key_frames', 'expr:gte(t,n_forced*2)'
    );
    if (scale && burn === undefined) args.push('-vf', `scale=-2:${Math.round(options.height as number)}`);
  }
  args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2');
  return args;
}

export function ffmpegTranscodeArgs(filePath: string, startSeconds = 0, options: TranscodeOptions = {}): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  // -ss before -i seeks fast on the input; output timestamps restart at zero.
  if (startSeconds > 0) args.push('-ss', String(startSeconds));
  args.push('-i', filePath, ...encodeArgs(options));
  args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof');
  args.push('-f', 'mp4', 'pipe:1');
  return args;
}

/**
 * Same conversion, packaged as HLS (a growing, seekable playlist plus small .ts segments) instead of one
 * progressive stream. Safari, and the many TV and embedded browsers built on the same engine, refuse to
 * play a live fragmented-MP4 stream from a plain `<video src>` at all ("could not decode the video") even
 * though the bytes are perfectly good H.264/AAC; HLS is what those browsers actually expect for a stream
 * whose length is not known up front, and it plays there natively, with no extra library.
 */
// The playlist and segments are written as bare relative names: the caller spawns ffmpeg with its
// working directory set to the session's own temp folder, so nothing here needs an absolute path
// (and the .m3u8 never ends up with a filesystem path baked into a segment URL).
export const HLS_PLAYLIST = 'index.m3u8';
export const HLS_SEGMENT_PATTERN = 'seg%05d.ts';

export function ffmpegHlsArgs(filePath: string, startSeconds = 0, options: TranscodeOptions = {}): string[] {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (startSeconds > 0) args.push('-ss', String(startSeconds));
  args.push('-i', filePath, ...encodeArgs(options));
  args.push(
    '-f', 'hls',
    '-hls_time', '2',
    // "vod" tells ffmpeg the whole playlist is already known, so it withholds index.m3u8 until the
    // entire file has finished encoding - fine for a few seconds of test clip, but a real movie or
    // episode can take minutes, and every request in that window saw a 503 ("has not produced anything
    // yet") because the playlist genuinely did not exist. "event" is what this actually is - a playlist
    // that grows as ffmpeg goes - and ffmpeg writes and updates it after every segment, so the player
    // gets something to play within a couple of seconds like it is meant to.
    '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_filename', HLS_SEGMENT_PATTERN,
    HLS_PLAYLIST
  );
  return args;
}

export interface TranscodeHandle {
  process: ChildProcess;
}

/** Start an ffmpeg transcode to fragmented MP4 on stdout. Returns null if unavailable. */
export function startTranscode(filePath: string, startSeconds = 0, options: TranscodeOptions = {}): TranscodeHandle | null {
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) return null;
  const child = spawn(ffmpeg, ffmpegTranscodeArgs(filePath, startSeconds, options), { stdio: ['ignore', 'pipe', 'pipe'] });
  return { process: child };
}

/** Extract an embedded text subtitle stream as WebVTT (bitmap subtitles are not supported). */
export function extractSubtitleVtt(filePath: string, streamIndex: number): Promise<string | null> {
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg || !Number.isInteger(streamIndex) || streamIndex < 0) return Promise.resolve(null);
  return new Promise(resolve => {
    let out = '';
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', filePath, '-map', `0:s:${streamIndex}`, '-f', 'webvtt', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 120_000);
    child.stdout?.on('data', chunk => { out += chunk.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', code => { clearTimeout(timer); resolve(code === 0 && out.includes('WEBVTT') ? out : null); });
  });
}
