import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'vv-imgcache-'));
process.env.VV_DATA_DIR = dataDir;
const { pickFormats, hdHeightsOf } = await import('../../apps/server/src/services/invidious');
const { ffmpegRemuxArgs } = await import('../../apps/server/src/services/transcode');
const { allowedImageUrl, cachedImage, fetchImage, MAX_BYTES } = await import('../../apps/server/src/services/image-cache');

afterEach(() => vi.unstubAllGlobals());
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const v = (itag: number, label: string, codec: string, fps = 30) => ({ itag: String(itag), type: `video/${codec.startsWith('avc1') || codec.startsWith('av01') ? 'mp4' : 'webm'}; codecs="${codec}"`, qualityLabel: label, fps, url: `/videoplayback?itag=${itag}` });
const FORMATS = [
  { itag: '251', type: 'audio/webm; codecs="opus"', url: '/videoplayback?itag=251' },
  { itag: '140', type: 'audio/mp4; codecs="mp4a.40.2"', url: '/videoplayback?itag=140' },
  v(134, '360p', 'avc1.4D401E'), v(135, '480p', 'avc1.4D401F'), v(136, '720p', 'avc1.4D401F'), v(298, '720p60', 'avc1.4D4020', 60),
  v(137, '1080p', 'avc1.640028'), v(303, '1080p60', 'vp9', 60), v(399, '1080p60', 'av01.0.09M.08', 60), v(308, '1440p60', 'vp9', 60), v(264, '1440p', 'avc1.640032')
];

describe('Videos in HD: which versions are joined', () => {
  it('takes the tallest H.264 picture at or under the cap, never VP9 or AV1, with AAC sound (itag 140)', () => {
    expect(pickFormats(FORMATS, 1080)).toMatchObject({ height: 1080, video: { itag: '137' }, audio: { itag: '140' } });
    expect(pickFormats(FORMATS, 0)?.height).toBe(1080); // Auto with no cap still stops at 1080p
    expect(pickFormats(FORMATS, 4320)?.height).toBe(1080);
    expect(pickFormats(FORMATS, 600)).toMatchObject({ height: 480, video: { itag: '135' } });
    expect(pickFormats(FORMATS, 100)).toMatchObject({ height: 360 }); // nothing that small: the shortest there is
  });

  it('prefers the smoother version at the same height', () => {
    expect(pickFormats(FORMATS, 720)?.video.itag).toBe('298');
  });

  it('gives nothing to join without H.264 or without AAC', () => {
    expect(pickFormats(FORMATS.filter(f => !/avc1/.test(f.type)), 1080)).toBeNull();
    expect(pickFormats(FORMATS.filter(f => !/mp4a/.test(f.type)), 1080)).toBeNull();
    expect(hdHeightsOf(FORMATS.filter(f => !/mp4a/.test(f.type)))).toEqual([]);
    expect(pickFormats(undefined, 1080)).toBeNull();
  });

  it('lists the heights the menu can offer, tallest first, up to 1080p', () => {
    expect(hdHeightsOf(FORMATS)).toEqual([1080, 720, 480, 360]);
  });

  it('joins by copying both streams (no re-encode), seeking both inputs to the same point', () => {
    const args = ffmpegRemuxArgs('http://inv/v', 'http://inv/a', 95);
    expect(args.join(' ')).toContain('-ss 95 -i http://inv/v -ss 95 -i http://inv/a');
    expect(args.join(' ')).toContain('-c copy');
    expect(args).not.toContain('libx264');
    expect(ffmpegRemuxArgs('v', 'a', 0)).not.toContain('-ss');
  });
});

const img = (body: BodyInit | null, init: ResponseInit) => new Response(body, init);
const JPEG = { status: 200, headers: { 'content-type': 'image/jpeg' } };

describe('Channel pictures: fetched and cached by the server, only from YouTube image hosts', () => {
  it('allows only https on the three image hosts', () => {
    for (const ok of ['https://yt3.ggpht.com/a=s88', 'https://yt3.googleusercontent.com/a', 'https://i.ytimg.com/vi/x/mq.jpg']) expect(allowedImageUrl(ok)).toBe(true);
    for (const bad of ['http://yt3.ggpht.com/a', 'https://evil.example/a', 'https://yt3.ggpht.com.evil.example/a', 'https://user@yt3.ggpht.com/a', 'https://yt3.ggpht.com:8443/a', 'file:///etc/passwd', 'nope'])
      expect(allowedImageUrl(bad)).toBe(false);
  });

  it('never fetches another host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchImage('https://evil.example/a.jpg')).toBeNull();
    expect(await cachedImage('http://127.0.0.1:3000/api/admin')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows a redirect only to an allowed host', async () => {
    const fetchMock = vi.fn(async (url: string) => url.includes('ggpht')
      ? img(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } })
      : img('x', JPEG));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchImage('https://yt3.ggpht.com/a')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('ggpht')
      ? img(null, { status: 302, headers: { location: 'https://yt3.googleusercontent.com/a' } })
      : img('pic', JPEG)));
    expect((await fetchImage('https://yt3.ggpht.com/a'))?.bytes.toString()).toBe('pic');
  });

  it('refuses anything that is not a raster image, and anything too big', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream']) {
      vi.stubGlobal('fetch', vi.fn(async () => img('<svg/>', { status: 200, headers: { 'content-type': type } })));
      expect(await fetchImage('https://yt3.ggpht.com/a')).toBeNull();
    }
    vi.stubGlobal('fetch', vi.fn(async () => img(new Uint8Array(MAX_BYTES + 1), JPEG)));
    expect(await fetchImage('https://yt3.ggpht.com/a')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => img('x', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(MAX_BYTES * 2) } })));
    expect(await fetchImage('https://yt3.ggpht.com/a')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => img('x', { status: 404, headers: { 'content-type': 'image/jpeg' } })));
    expect(await fetchImage('https://yt3.ggpht.com/a')).toBeNull();
  });

  it('keeps a picture on disk and serves it again without the network', async () => {
    const fetchMock = vi.fn(async () => img('avatar', JPEG));
    vi.stubGlobal('fetch', fetchMock);
    expect((await cachedImage('https://yt3.ggpht.com/cached=s88'))?.type).toBe('image/jpeg');
    expect((await cachedImage('https://yt3.ggpht.com/cached=s88'))?.bytes.toString()).toBe('avatar');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readdirSync(join(dataDir, 'image-cache'))).toHaveLength(1);
  });
});
