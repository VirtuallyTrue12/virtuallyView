import { mkdirSync, mkdtempSync, existsSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Offline downloads: the file-output arguments, the progress parser, the sweep, the per-user limit and the
// rule that only the account which started a job can see it. ffmpeg itself is never run here.

const root = mkdtempSync(path.join(tmpdir(), 'vv-offline-test-'));
const media = path.join(root, 'media');
mkdirSync(media, { recursive: true });
process.env.VV_DATA_DIR = path.join(root, 'data');
process.env.VV_TEST_MEDIA = media;

const spawnMode = vi.hoisted(() => ({ mode: 'hang' as 'hang' | 'ok' }));

vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  const { writeFileSync: write } = await import('node:fs');
  return {
    spawnSync: vi.fn(() => ({ status: 1 })),
    spawn: vi.fn((_bin: string, args: string[]) => {
      const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
      if (spawnMode.mode === 'ok') {
        // Pretend ffmpeg wrote the output and exited cleanly.
        const out = args[args.length - 1]!;
        setTimeout(() => { write(out, 'fake mp4'); proc.emit('close', 0); }, 5);
      }
      return proc;
    })
  };
});

vi.mock('../../apps/server/src/lib/limits.js', () => ({
  acquireConversion: () => () => undefined,
  CONVERSION_MAX_MS: 999_999_999
}));

vi.mock('../../apps/server/src/routes/stream.js', () => ({
  resolveStreamable: async (id: string) => {
    if (!id.startsWith('radarr-') || id.endsWith('-404')) return null;
    return { fileInfo: { path: path.join(process.env.VV_TEST_MEDIA!, `${id}.mkv`) } };
  },
  resolveEpisodeFile: async () => null,
  episodeAllowed: async () => true,
  isAllowedMediaFile: () => true
}));

vi.mock('../../apps/server/src/services/transcode.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../apps/server/src/services/transcode.js')>();
  return {
    ...actual,
    resolveBinary: () => '/usr/bin/ffmpeg',
    vaapiDevice: () => null,
    extractSubtitleVtt: async () => null,
    probeMedia: async () => ({
      playable: false, container: 'mkv', videoCodec: 'hevc', audioCodec: 'ac3', durationSeconds: 100, height: 1080,
      audioTracks: [
        { index: 0, codec: 'ac3', language: 'fre', title: '', channels: 6 },
        { index: 1, codec: 'aac', language: 'eng', title: '', channels: 2 }
      ],
      subtitleStreams: []
    })
  };
});

const transcode = await import('../../apps/server/src/services/transcode.js');
const offline = await import('../../apps/server/src/services/offline-jobs.js');

const until = async (check: () => boolean) => {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('timed out waiting');
};

beforeAll(() => {
  for (const id of ['radarr-1', 'radarr-2', 'radarr-3', 'radarr-4']) writeFileSync(path.join(media, `${id}.mkv`), 'source');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  offline.resetOfflineJobsForTests();
  spawnMode.mode = 'hang';
});

describe('file-output arguments for offline copies', () => {
  it('writes a faststart MP4 with H.264 video and stereo AAC, and reports progress on stdout', () => {
    const args = transcode.ffmpegFileArgs('/media/a.mkv', '/data/out.partial', { kind: 'video', quality: 'standard', audio: 1, sourceHeight: 1080 });
    const flag = args.indexOf('-movflags');
    expect(args[flag + 1]).toBe('+faststart');
    expect(args).toContain('-c:v');
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args[args.indexOf('-b:a') + 1]).toBe('160k');
    expect(args[args.indexOf('-ac') + 1]).toBe('2');
    expect(args.slice(args.indexOf('-progress'), args.indexOf('-progress') + 2)).toEqual(['-progress', 'pipe:1']);
    expect(args[args.length - 1]).toBe('/data/out.partial');
  });

  it('keeps the English audio track that was picked (the second track here)', () => {
    const args = transcode.ffmpegFileArgs('/media/a.mkv', '/data/out.partial', { kind: 'video', audio: 1, sourceHeight: 1080 });
    expect(args).toContain('0:a:1?');
    expect(args).not.toContain('0:a:0?');
  });

  it('standard is 720p and high is 1080p, and neither is ever taller than the source', () => {
    const standard = transcode.ffmpegFileArgs('/m.mkv', '/o', { kind: 'video', quality: 'standard', sourceHeight: 2160 });
    expect(standard).toContain('scale=-2:720');
    const high = transcode.ffmpegFileArgs('/m.mkv', '/o', { kind: 'video', quality: 'high', sourceHeight: 2160 });
    expect(high).toContain('scale=-2:1080');
    const highSmall = transcode.ffmpegFileArgs('/m.mkv', '/o', { kind: 'video', quality: 'high', sourceHeight: 720 });
    expect(highSmall.some(a => a.startsWith('scale'))).toBe(false);
    expect(highSmall[highSmall.indexOf('-crf') + 1]).toBe('21');
  });

  it('uses the GPU encoder and scales on the GPU when a VA-API device is given', () => {
    const args = transcode.ffmpegFileArgs('/m.mkv', '/o', { kind: 'video', quality: 'standard', sourceHeight: 1080, vaapi: '/dev/dri/renderD128' });
    expect(args).toContain('h264_vaapi');
    expect(args).toContain('-init_hw_device');
    expect(args.some(a => a.includes('scale_vaapi=w=-2:h=720'))).toBe(true);
  });

  it('copies MP3 or AAC song audio unchanged, and converts anything else to AAC 256k', () => {
    const mp3 = transcode.ffmpegFileArgs('/s.mp3', '/o', { kind: 'audio', audioCodec: 'mp3' });
    // MP3 in an MP4 container is unreliable on iPhones, so it is converted; AAC is copied as it is.
    expect(mp3[mp3.indexOf('-c:a') + 1]).toBe('aac');
    const aac = transcode.ffmpegFileArgs('/s.m4a', '/o', { kind: 'audio', audioCodec: 'aac' });
    expect(aac[aac.indexOf('-c:a') + 1]).toBe('copy');
    expect(mp3).toContain('-vn');
    const flac = transcode.ffmpegFileArgs('/s.flac', '/o', { kind: 'audio', audioCodec: 'flac' });
    expect(flac[flac.indexOf('-c:a') + 1]).toBe('aac');
    expect(flac[flac.indexOf('-b:a') + 1]).toBe('256k');
    expect(flac).toContain('+faststart');
  });

  it('picks the English track unless one was asked for, and falls back to the first track', () => {
    const tracks = [
      { index: 0, codec: 'ac3', language: 'fre', title: '', channels: 6 },
      { index: 1, codec: 'aac', language: 'en', title: '', channels: 2 }
    ];
    expect(transcode.pickAudioIndex(tracks)).toBe(1);
    expect(transcode.pickAudioIndex(tracks, 0)).toBe(0);
    expect(transcode.pickAudioIndex([{ index: 0, codec: 'ac3', language: 'fre', title: '', channels: 6 }])).toBe(0);
    expect(transcode.pickAudioIndex(tracks, 9)).toBe(1);
  });
});

describe('progress parser', () => {
  it('turns the last out_time_us line into a percentage of the duration', () => {
    expect(offline.progressPercent('out_time_us=50000000\nprogress=continue\n', 100)).toBe(50);
    expect(offline.progressPercent('out_time_us=10000000\nout_time_us=75000000\n', 100)).toBe(75);
  });

  it('reads ffmpeg out_time_ms (which holds microseconds) the same way', () => {
    expect(offline.progressPercent('out_time_ms=30000000\n', 60)).toBe(50);
  });

  it('falls back to the clock form and never reports 100 before the job is done', () => {
    expect(offline.progressPercent('out_time=00:01:40.000000\n', 200)).toBe(50);
    expect(offline.progressPercent('out_time_us=99999000000\n', 100)).toBe(99);
  });

  it('has no percentage without a duration or a time', () => {
    expect(offline.progressPercent('out_time_us=50000000\n', null)).toBeNull();
    expect(offline.progressPercent('progress=continue\n', 100)).toBeNull();
  });
});

describe('sweep', () => {
  it('removes a prepared copy a day after it finished, and clears old orphan files', async () => {
    spawnMode.mode = 'ok';
    const first = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-1' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await until(() => offline.getOfflineJob('alice', first.job.id)?.status === 'ready');
    const file = path.join(process.env.VV_DATA_DIR!, 'offline', first.job.fileName);
    expect(existsSync(file)).toBe(true);

    expect(offline.sweepOfflineFiles(Date.now())).toBe(0);
    expect(offline.sweepOfflineFiles(Date.now() + 25 * 3_600_000)).toBeGreaterThan(0);
    expect(offline.getOfflineJob('alice', first.job.id)).toBeNull();
    expect(existsSync(file)).toBe(false);

    const orphan = path.join(process.env.VV_DATA_DIR!, 'offline', 'old-leftover.mp4');
    writeFileSync(orphan, 'old');
    const twoDaysAgo = (Date.now() - 2 * 24 * 3_600_000) / 1000;
    utimesSync(orphan, twoDaysAgo, twoDaysAgo);
    offline.sweepOfflineFiles();
    expect(readdirSync(path.join(process.env.VV_DATA_DIR!, 'offline'))).not.toContain('old-leftover.mp4');
  });
});

describe('shared copies and quality', () => {
  it('a second account asking for the same item reuses the first conversion', async () => {
    const a = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-1', quality: 'small' });
    const b = await offline.prepareOfflineJob('bob', { kind: 'movie', id: 'radarr-1', quality: 'small' });
    if (!a.ok || !b.ok) throw new Error('expected jobs');
    expect(b.job.id).toBe(a.job.id);
    expect(offline.getOfflineJob('bob', a.job.id)?.quality).toBe('small');
    expect(offline.getOfflineJob('carol', a.job.id)).toBeNull();
  });

  it('small is 480p with a lower quality target and audio rate', () => {
    const args = transcode.ffmpegFileArgs('/m.mkv', '/o', { kind: 'video', quality: 'small', sourceHeight: 1080 });
    expect(args.join(' ')).toMatch(/scale[^ ]*480/);
    expect(args).toContain('28');
    expect(args).toContain('96k');
  });
});

describe('per-user limits and ownership', () => {
  it('lets one account run three downloads at once, refuses a fourth with a plain message, and leaves other accounts alone', async () => {
    const a = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-1' });
    const b = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-2' });
    const c = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-3' });
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);

    const fourth = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-4' });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) {
      expect(fourth.status).toBe(429);
      expect(fourth.message).toMatch(/3 downloads/);
    }

    const bob = await offline.prepareOfflineJob('bob', { kind: 'movie', id: 'radarr-4' });
    expect(bob.ok).toBe(true);
  });

  it('asking for the same item again returns the job already running, not a new one', async () => {
    const first = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-1' });
    const again = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-1' });
    if (!first.ok || !again.ok) throw new Error('expected jobs');
    expect(again.job.id).toBe(first.job.id);
  });

  it('another account cannot read a job, by id or by any other means the route offers', async () => {
    const mine = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-1' });
    if (!mine.ok) throw new Error('expected a job');
    expect(offline.getOfflineJob('alice', mine.job.id)?.id).toBe(mine.job.id);
    expect(offline.getOfflineJob('bob', mine.job.id)).toBeNull();
    expect(offline.readyFilePath(mine.job)).toBeNull();
  });

  it('refuses an item the viewer may not see, with the same message as a missing one', async () => {
    const hidden = await offline.prepareOfflineJob('alice', { kind: 'movie', id: 'radarr-404' });
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.status).toBe(404);
  });
});
