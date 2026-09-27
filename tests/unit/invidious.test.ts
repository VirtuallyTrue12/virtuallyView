import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedUrl, invidiousAvailable, NotConfigured, searchVideos, thumbnailUpstream, videoInfo } from '../../apps/server/src/services/invidious';

const withUrl = (url: string | undefined) => { if (url === undefined) delete process.env.INVIDIOUS_URL; else process.env.INVIDIOUS_URL = url; };
afterEach(() => { withUrl(undefined); vi.unstubAllGlobals(); });

describe('Invidious (private YouTube search and playback)', () => {
  it('is unavailable, with a clear message, when INVIDIOUS_URL is not set', async () => {
    withUrl(undefined);
    await expect(searchVideos('test')).rejects.toBeInstanceOf(NotConfigured);
    expect(embedUrl('dQw4w9WgXcQ')).toBeNull();
    expect(thumbnailUpstream('dQw4w9WgXcQ')).toBeNull();
    expect(await invidiousAvailable()).toBe(false);
  });

  it('maps a search result and skips anything without a real 11-character video id', async () => {
    withUrl('http://invidious.local');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { videoId: 'dQw4w9WgXcQ', title: 'A Song', author: 'A Channel', authorId: 'UC123', lengthSeconds: 213, viewCount: 1_000_000_000, videoThumbnails: [{ url: 'http://invidious.local/vi/dQw4w9WgXcQ/mq.jpg', quality: 'medium' }] },
      { videoId: 'nope', title: 'Bad id' }
    ]), { status: 200, headers: { 'content-type': 'application/json' } })));
    const results = await searchVideos('a song');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: 'dQw4w9WgXcQ', title: 'A Song', channel: 'A Channel', channelId: 'UC123', durationSeconds: 213, views: 1_000_000_000, thumbnail: 'http://invidious.local/vi/dQw4w9WgXcQ/mq.jpg' });
  });

  it('an empty search never reaches the network', async () => {
    withUrl('http://invidious.local');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchVideos('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('looks up one video by id, and refuses an id that is not a real YouTube id', async () => {
    withUrl('http://invidious.local');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ videoId: 'dQw4w9WgXcQ', title: 'A Song', author: 'A Channel', lengthSeconds: 213, viewCount: 5 }), { status: 200, headers: { 'content-type': 'application/json' } })));
    expect(await videoInfo('dQw4w9WgXcQ')).toMatchObject({ id: 'dQw4w9WgXcQ', title: 'A Song' });
    expect(await videoInfo('; rm -rf /')).toBeNull();
  });

  it('the embed and thumbnail addresses point at the configured instance, never YouTube directly', () => {
    withUrl('http://invidious.local/');
    expect(embedUrl('dQw4w9WgXcQ')).toBe('http://invidious.local/embed/dQw4w9WgXcQ?local=true');
    expect(thumbnailUpstream('dQw4w9WgXcQ')).toBe('http://invidious.local/vi/dQw4w9WgXcQ/mqdefault.jpg');
    expect(embedUrl('not-a-real-id')).toBeNull();
  });

  it('the bundled instance answers only to its internal Docker name, so a browser is given this server\'s own address on the published port instead', () => {
    withUrl('http://invidious:3000');
    expect(embedUrl('dQw4w9WgXcQ', 'myserver.local:3000')).toBe('http://myserver.local:3300/embed/dQw4w9WgXcQ?local=true');
    // A public instance's own domain is already something a browser can reach: it is used as-is.
    withUrl('https://yewtu.be');
    expect(embedUrl('dQw4w9WgXcQ', 'myserver.local:3000')).toBe('https://yewtu.be/embed/dQw4w9WgXcQ?local=true');
  });
});
