import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Device detection is stubbed: the test encode "succeeds" when `gpu` is set, and `-filters` lists `filters`.
const stub = vi.hoisted(() => ({ gpu: true, filters: ['scale_vaapi', 'tonemap_vaapi', 'zscale', 'tonemap'] }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: (_bin: string, args: string[]) => args.includes('-filters')
      ? { status: 0, stdout: stub.filters.map(f => ` .. ${f}  V->V  x`).join('\n') }
      : { status: stub.gpu ? 0 : 1, stdout: '' }
  };
});
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: (p: string) => p.startsWith('/dev/dri/') || actual.existsSync(p) };
});

async function load(gpu: boolean, filters = ['scale_vaapi', 'tonemap_vaapi', 'zscale', 'tonemap']) {
  Object.assign(stub, { gpu, filters });
  vi.resetModules();
  process.env.VV_HWACCEL = '';
  process.env.FFMPEG_PATH = '/bin/sh'; // any existing file: resolveBinary only checks it is there
  return import('../../apps/server/src/services/transcode');
}
const vf = (args: string[]) => args[args.indexOf('-vf') + 1];

afterEach(() => { process.env.VV_HWACCEL = 'none'; delete process.env.FFMPEG_PATH; });

describe('hardware video conversion', () => {
  it('decodes, scales and encodes on the GPU, and takes CPU-decoded frames when the GPU cannot decode the codec', async () => {
    const t = await load(true);
    const args = t.ffmpegTranscodeArgs('/m/a.mkv', 0, { sourceHeight: 2160 });
    expect(args.slice(0, args.indexOf('-i'))).toEqual(expect.arrayContaining(['-hwaccel', 'vaapi', '-hwaccel_output_format', 'vaapi']));
    expect(vf(args)).toBe('format=nv12|p010|vaapi,hwupload,scale_vaapi=w=-2:h=1080:format=nv12');
    expect(args).toContain('h264_vaapi');
    // Same plan for HLS and offline copies.
    expect(t.ffmpegHlsArgs('/m/a.mkv', 0, {})).toContain('-hwaccel');
    const file = t.ffmpegFileArgs('/m.mkv', '/o', { kind: 'video', sourceHeight: 1080, vaapi: '/dev/dri/renderD128' });
    expect(file).toContain('-hwaccel');
    expect(vf(file)).toContain('scale_vaapi=w=-2:h=720:format=nv12');
  });

  it('keeps burned-in subtitles on the CPU, tone mapped first when the source is HDR', async () => {
    const t = await load(true);
    const args = t.ffmpegTranscodeArgs('/m/a.mkv', 0, { burn: 1, hdr: 'pq', hdrMastering: true });
    expect(args).not.toContain('-hwaccel');
    expect(args).toContain('libx264');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toMatch(/^\[0:v:0\]zscale=t=linear.*tonemap=hable.*\[base\];\[base\]\[0:s:1\]overlay\[v\]$/);
  });

  it('tone maps HDR10 with mastering data on the GPU, and HLG or bare PQ on the CPU before upload', async () => {
    const t = await load(true);
    const pq = t.ffmpegTranscodeArgs('/m/a.mkv', 0, { hdr: 'pq', hdrMastering: true });
    expect(vf(pq)).toContain('hwupload,tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709,scale_vaapi=');
    expect(pq).toContain('-hwaccel');
    for (const opts of [{ hdr: 'hlg' as const }, { hdr: 'pq' as const, hdrMastering: false }]) {
      const args = t.ffmpegTranscodeArgs('/m/a.mkv', 0, opts);
      expect(vf(args)).toMatch(/^zscale=t=linear.*tonemap=hable.*format=nv12,hwupload,scale_vaapi=format=nv12$/);
      expect(args).not.toContain('-hwaccel'); // the CPU chain needs frames in memory
    }
    expect(vf(t.ffmpegTranscodeArgs('/m/a.mkv', 0, {}))).not.toContain('tonemap');
  });

  it('uses the CPU chain when this ffmpeg has no tonemap_vaapi, and does nothing without zscale', async () => {
    let t = await load(true, ['scale_vaapi', 'zscale', 'tonemap']);
    expect(vf(t.ffmpegTranscodeArgs('/m/a.mkv', 0, { hdr: 'pq', hdrMastering: true }))).toMatch(/^zscale/);
    expect(t.videoHardwareReport().tonemap).toBe('cpu');
    t = await load(false, ['scale']);
    expect(t.ffmpegTranscodeArgs('/m/a.mkv', 0, { hdr: 'pq' })).not.toContain('-vf');
    expect(t.videoHardwareReport()).toEqual({ converter: 'Processor only', tonemap: null });
  });

  it('falls back to the CPU encoder with the CPU tone mapping chain when there is no GPU', async () => {
    const t = await load(false);
    const args = t.ffmpegTranscodeArgs('/m/a.mkv', 0, { hdr: 'hlg', height: 720 });
    expect(args).not.toContain('-init_hw_device');
    expect(args).toContain('libx264');
    expect(vf(args)).toMatch(/tonemap=hable.*format=yuv420p,scale=-2:720$/);
    // A copy never gets filters.
    expect(t.ffmpegTranscodeArgs('/m/a.mkv', 0, { copyVideo: true, hdr: 'pq' })).not.toContain('-vf');
  });
});

// Real encodes of tiny generated clips, only where this machine has a working VA-API device and ffmpeg.
const device = '/dev/dri/renderD128';
const real = vi.importActual<typeof import('node:child_process')>('node:child_process');
const ffmpegOk = async () => (await real).spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-init_hw_device', `vaapi=va:${device}`, '-filter_hw_device', 'va',
  '-f', 'lavfi', '-i', 'testsrc=size=320x240:duration=0.2', '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-']).status === 0;

describe('hardware conversion on this machine', async () => {
  const usable = existsSync(device) && await ffmpegOk();
  it.skipIf(!usable)('converts H.264, a codec the GPU cannot decode, and HDR10 to SDR H.264', async () => {
    const { spawnSync: run } = await real;
    const t = await load(true, String(run('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout).split('\n').map(l => l.trim().split(/\s+/)[1]).filter(Boolean));
    process.env.FFMPEG_PATH = 'ffmpeg';
    const dir = mkdtempSync(path.join(tmpdir(), 'vv-hw-'));
    try {
      const make = (name: string, codec: string[]) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:duration=1:rate=24', ...codec, path.join(dir, name)]).status === 0;
      expect(make('a.mkv', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'])).toBe(true);
      expect(make('b.avi', ['-c:v', 'mpeg4'])).toBe(true);
      const hdr = make('c.mkv', ['-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params',
        'log-level=error:hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400',
        '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc']);
      const inputs: Array<[string, Parameters<typeof t.ffmpegFileArgs>[2]]> = [
        ['a.mkv', { kind: 'video', sourceHeight: 360, vaapi: device }],
        ['b.avi', { kind: 'video', sourceHeight: 360, vaapi: device }]
      ];
      if (hdr) {
        const probe = await t.probeMedia(path.join(dir, 'c.mkv'));
        expect(probe.hdr).toBe('pq');
        expect(probe.hdrMastering).toBe(true);
        inputs.push(['c.mkv', { kind: 'video', sourceHeight: 360, vaapi: device, hdr: probe.hdr, hdrMastering: probe.hdrMastering }]);
      }
      for (const [name, opts] of inputs) {
        const out = path.join(dir, `${name}.mp4`);
        const args = t.ffmpegFileArgs(path.join(dir, name), out, opts).filter(a => a !== '-progress' && a !== 'pipe:1');
        const res = run('ffmpeg', args, { encoding: 'utf8' });
        expect(res.status, `${name}: ${res.stderr}`).toBe(0);
        const info = String(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,color_transfer', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout).trim();
        expect(info.startsWith('h264,yuv420p')).toBe(true);
        if (name === 'c.mkv') expect(info).toContain('bt709');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
