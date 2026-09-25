import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'vv-art-'));

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('find more artwork', () => {
  it('gathers artist photos and album covers from several sources, only for the right artist, without duplicates', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('deezer.com/search/artist')) return reply({ data: [{ id: 5, name: 'Somebody Else', picture_xl: 'https://cdn-images.dzcdn.net/wrong.jpg' }, { id: 92, name: 'Linkin Park', picture_xl: 'https://cdn-images.dzcdn.net/images/artist/abc/1000x1000-000000-80-0-0.jpg' }] });
      if (url.includes('deezer.com/artist/92/albums')) return reply({ data: [{ title: 'Meteora', cover_xl: 'https://cdn-images.dzcdn.net/images/cover/m/1000x1000-000000-80-0-0.jpg' }] });
      if (url.includes('itunes.apple.com')) return reply({ results: [
        { artistName: 'LINKIN PARK', collectionName: 'Hybrid Theory', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/100x100bb.jpg' },
        { artistName: 'Linkin Park Tribute Band', collectionName: 'Not Them', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/y/100x100bb.jpg' }
      ] });
      if (url.includes('media-list')) return reply({ items: [
        { type: 'image', title: 'File:Linkin_Park_2017.jpg', showInGallery: true, srcset: [{ src: '//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Linkin_Park_2017.jpg/500px-Linkin_Park_2017.jpg?x=1' }] },
        { type: 'image', title: 'File:Linkin_Park_logo.png', showInGallery: true, srcset: [{ src: '//upload.wikimedia.org/logo.png' }] },
        { type: 'image', title: 'File:Flag_of_the_US.svg', showInGallery: true, srcset: [{ src: '//upload.wikimedia.org/flag.svg' }] }
      ] });
      return new Response('{}', { status: 404 });
    }));
    const { findMoreArtwork } = await import('../../apps/server/src/services/artist-artwork.js');
    const found = await findMoreArtwork('Linkin Park', [{ title: 'Meteora', mbid: 'abc-123' }]);
    const bySource = (s: string) => found.filter(c => c.source === s);
    expect(bySource('deezer').map(c => c.kind)).toEqual(['artist', 'album']);
    expect(found.some(c => c.url.includes('wrong.jpg'))).toBe(false);
    expect(bySource('itunes')).toHaveLength(1);
    expect(bySource('itunes')[0]!.url).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/x/1000x1000bb.jpg');
    expect(bySource('wikipedia').map(c => c.url)).toEqual(['https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Linkin_Park_2017.jpg/500px-Linkin_Park_2017.jpg']);
    expect(bySource('musicbrainz')[0]).toMatchObject({ url: 'https://coverartarchive.org/release-group/abc-123/front-500', kind: 'album' });
    expect(new Set(found.map(c => c.url)).size).toBe(found.length);
  });

  it('carries on when a source is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { findMoreArtwork } = await import('../../apps/server/src/services/artist-artwork.js');
    expect(await findMoreArtwork('Nobody', [])).toEqual([]);
  });

  it('serves the new image hosts through the server and refuses others', async () => {
    const { artProxyUrl } = await import('@virtuallyview/integrations');
    for (const host of ['cdn-images.dzcdn.net', 'is1-ssl.mzstatic.com', 'upload.wikimedia.org', 'coverartarchive.org']) expect(artProxyUrl(`https://${host}/x.jpg`)).toMatch(/^\/api\/art\?u=/);
    expect(artProxyUrl('https://evil.example.com/x.jpg')).toBe('https://evil.example.com/x.jpg');
  });
});
