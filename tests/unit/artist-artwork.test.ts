import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'vv-art-'));

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('find more artwork: pictures of the artist, not their albums', () => {
  it('gathers logo, portraits, group and live photos from several sources, without duplicates or album covers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('deezer.com/search/artist')) return reply({ data: [{ name: 'Somebody Else', picture_xl: 'https://cdn-images.dzcdn.net/wrong.jpg' }, { name: 'Linkin Park', picture_xl: 'https://cdn-images.dzcdn.net/images/artist/abc/1000x1000.jpg' }] });
      if (url.includes('media-list')) return reply({ items: [
        { type: 'image', title: 'File:Linkin_Park_2017.jpg', showInGallery: true, srcset: [{ src: '//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Linkin_Park_2017.jpg/500px-Linkin_Park_2017.jpg?x=1' }] },
        { type: 'image', title: 'File:Linkin_Park_band_members_2003.jpg', showInGallery: true, srcset: [{ src: '//upload.wikimedia.org/g.jpg' }] },
        { type: 'image', title: 'File:Meteora_album_cover.jpg', showInGallery: true, srcset: [{ src: '//upload.wikimedia.org/cover.jpg' }] },
        { type: 'image', title: 'File:Linkin_Park_logo.png', showInGallery: true, srcset: [{ src: '//upload.wikimedia.org/logo.png' }] }
      ] });
      if (url.includes('musicbrainz.org')) return reply({ relations: [
        { type: 'image', url: { resource: 'https://commons.wikimedia.org/wiki/File:LinkinParkBerlin2010.jpg' } },
        { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q261' } }
      ] });
      if (url.includes('wikidata.org')) return reply({ entities: { Q261: { claims: {
        P154: [{ mainsnak: { datavalue: { value: 'Linkin Park logo.svg' } } }],
        P18: [{ mainsnak: { datavalue: { value: 'LinkinParkBerlin2010.jpg' } } }],
        P2716: [{ mainsnak: { datavalue: { value: 'Linkin Park collage.jpg' } } }],
        P373: [{ mainsnak: { datavalue: { value: 'Linkin Park' } } }]
      } } } });
      if (url.includes('commons.wikimedia.org/w/api.php')) return reply({ query: { pages: {
        '1': { title: 'File:Linkin Park live Rock am Ring.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/live1.jpg', mime: 'image/jpeg' }] },
        '2': { title: 'File:Linkin Park album cover.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/cover2.jpg', mime: 'image/jpeg' }] },
        '3': { title: 'File:Linkin Park group photo.png', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/group3.png', mime: 'image/png' }] },
        '4': { title: 'File:Video.webm', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/v.jpg', mime: 'video/webm' }] }
      } } });
      return new Response('{}', { status: 404 });
    }));
    const { findMoreArtwork } = await import('../../apps/server/src/services/artist-artwork.js');
    const found = await findMoreArtwork('Linkin Park', { mbid: 'f59c' });
    const kinds = (k: string) => found.filter(c => c.kind === k).map(c => c.label);
    expect(kinds('logo')).toEqual(['Logo']);
    expect(found.find(c => c.kind === 'logo')!.url).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Linkin_Park_logo.svg?width=800');
    expect(kinds('group')).toEqual(expect.arrayContaining(['Group photo']));
    expect(found.some(c => c.url.includes('group3.png') && c.kind === 'group')).toBe(true);
    expect(found.some(c => c.url.includes('live1.jpg') && c.kind === 'live')).toBe(true);
    expect(found.some(c => c.source === 'deezer')).toBe(true);
    expect(found.some(c => c.url.includes('wrong.jpg'))).toBe(false);
    // No album covers, logos disguised as photos, or non-images.
    for (const bad of ['cover.jpg', 'cover2.jpg', 'v.jpg']) expect(found.some(c => c.url.endsWith(bad))).toBe(false);
    expect(found.filter(c => c.label?.includes('logo')).length).toBe(0);
    expect(new Set(found.map(c => c.url)).size).toBe(found.length);
  });

  it('turns what Lidarr already has into labelled candidates', async () => {
    const { lidarrArtwork } = await import('../../apps/server/src/services/artist-artwork.js');
    expect(lidarrArtwork([
      { coverType: 'clearlogo', url: '/config/MediaCover/4/clearlogo.png' }, { coverType: 'poster', url: '/config/MediaCover/4/poster.jpg' },
      { coverType: 'fanart', url: '/config/MediaCover/4/fanart.jpg' }, { coverType: 'banner', url: '/config/MediaCover/4/banner.jpg' }, { coverType: 'cover', url: '/x' }
    ]).map(c => [c.kind, c.label])).toEqual([['logo', 'Logo'], ['artist', 'Artist photo'], ['banner', 'Background'], ['banner', 'Banner']]);
  });

  it('carries on when every source is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { findMoreArtwork } = await import('../../apps/server/src/services/artist-artwork.js');
    expect(await findMoreArtwork('Nobody', { mbid: 'x' })).toEqual([]);
  });

  it('serves the image hosts through the server and refuses others', async () => {
    const { artProxyUrl } = await import('@virtuallyview/integrations');
    for (const host of ['cdn-images.dzcdn.net', 'upload.wikimedia.org', 'commons.wikimedia.org', 'assets.fanart.tv']) expect(artProxyUrl(`https://${host}/x.jpg`)).toMatch(/^\/api\/art\?u=/);
    expect(artProxyUrl('https://evil.example.com/x.jpg')).toBe('https://evil.example.com/x.jpg');
  });
});
