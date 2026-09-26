import { describe, expect, it } from 'vitest';
import { parseXmltv, xmltvTime } from '../../apps/server/src/services/epg.js';
import { epgUrlsOf, parseM3u } from '../../apps/server/src/services/live-tv.js';

const XML = `<?xml version="1.0"?><tv>
<channel id="bbc.one"><display-name>BBC One</display-name></channel>
<programme start="20260926100000 +0000" stop="20260926110000 +0000" channel="bbc.one"><title lang="en">Morning &amp; News</title><desc>All the &quot;headlines&quot;.</desc></programme>
<programme start="20260926110000 +0000" stop="20260926120000 +0000" channel="bbc.one"><title><![CDATA[Cooking <Live>]]></title></programme>
<programme start="20260926100000 +0000" stop="20260926110000 +0000" channel="other.tv"><title>Not wanted</title></programme>
<programme start="20260920100000 +0000" stop="20260920110000 +0000" channel="bbc.one"><title>Long ago</title></programme>
<programme start="20260926130000 +0200" stop="20260926140000 +0200" channel="bbc.one"><title>With offset</title></programme>
</tv>`;

describe('program guide (XMLTV)', () => {
  it('reads times with and without an offset', () => {
    expect(xmltvTime('20260926100000 +0000')).toBe(Date.UTC(2026, 8, 26, 10, 0, 0));
    expect(xmltvTime('20260926130000 +0200')).toBe(Date.UTC(2026, 8, 26, 11, 0, 0));
    expect(xmltvTime('20260926103000')).toBe(Date.UTC(2026, 8, 26, 10, 30, 0));
    expect(xmltvTime('garbage')).toBeNull();
  });

  it('keeps only wanted channels inside the window, decoded and in order', () => {
    const from = Date.UTC(2026, 8, 26, 9, 0, 0), to = Date.UTC(2026, 8, 26, 20, 0, 0);
    const out = parseXmltv(XML, new Set(['bbc.one']), from, to);
    expect([...out.keys()]).toEqual(['bbc.one']);
    const list = out.get('bbc.one')!;
    expect(list.map(p => p.title)).toEqual(['Morning & News', 'Cooking <Live>', 'With offset']);
    expect(list[0]!.desc).toBe('All the "headlines".');
    expect(list[2]!.start).toBe(Date.UTC(2026, 8, 26, 11, 0, 0));
  });

  it('finds the guide address in a playlist and each channel guide id', () => {
    const m3u = '#EXTM3U url-tvg="https://epg.example/guide.xml.gz, ftp://bad, https://epg.example/two.xml"\n#EXTINF:-1 tvg-id="bbc.one" group-title="News",BBC One\nhttp://x/a.m3u8\n#EXTINF:-1,No id\nhttp://x/b.m3u8\n';
    expect(epgUrlsOf(m3u)).toEqual(['https://epg.example/guide.xml.gz', 'https://epg.example/two.xml']);
    const channels = parseM3u(m3u, 'p');
    expect(channels.map(c => c.tvgId)).toEqual(['bbc.one', undefined]);
    expect(epgUrlsOf('#EXTM3U\n')).toEqual([]);
  });
});
