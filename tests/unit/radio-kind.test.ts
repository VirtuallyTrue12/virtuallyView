import { describe, expect, it } from 'vitest';
import { stationKind } from '../../apps/server/src/services/radio';
import { cleanTitle } from '../../apps/server/src/routes/lyrics';

describe('live broadcast or fan playlist', () => {
  it('marks free do-it-yourself hosts as playlists, even when named after a real FM station', () => {
    expect(stationKind({ url: 'https://stream.zeno.fm/abc123', name: 'BIG 92.7 FM' })).toBe('playlist');
    expect(stationKind({ url: 'http://eu8.fastcast4u.com/proxy/x?mp=/1', name: 'Radio Mirchi Hindi' })).toBe('playlist');
    expect(stationKind({ url: 'https://azuracast.vibesounds.in:8010/radio.mp3', name: 'Hindi Gold Radio' })).toBe('playlist');
    expect(stationKind({ url: 'https://example.net/stream', name: 'KISSTORY Non-Stop' })).toBe('playlist');
  });

  it('marks broadcaster streams and news and talk as live, even with a playlist-like name', () => {
    expect(stationKind({ url: 'https://air.pc.cdn.bitgravity.com/air/live/pbaudio001/playlist.m3u8', name: 'Vividh Bharati' })).toBe('live');
    expect(stationKind({ url: 'http://media-ice.musicradio.com/Heart80sMP3', name: 'Heart 80s' })).toBe('live');
    expect(stationKind({ url: 'https://stream.example.org/live', name: 'City Talk', tags: 'news,talk' })).toBe('live');
    expect(stationKind({ url: 'https://airhlspush.pc.cdn.bitgravity.com/httppush/hlsbg_raagam/playlist.m3u8', name: 'Raagam AIR 24*7' })).toBe('live');
  });

  it('needs positive evidence: real-world broadcasters are live', () => {
    expect(stationKind({ url: 'http://as-hls-ww-live.akamaized.net/pool_904/live/ww/bbc_radio_four/x.m3u8', name: 'BBC Radio 4' })).toBe('live');
    expect(stationKind({ url: 'https://26433.live.streamtheworld.com/X.mp3', name: '.977 80s' })).toBe('live');
    expect(stationKind({ url: 'https://stream.revma.ihrhls.com/zc185', name: '102.7 KIIS FM Los Angeles' })).toBe('live');
    expect(stationKind({ url: 'https://fm939.wnyc.org/wnycfm', name: 'WNYC 93.9 FM', tags: 'news' })).toBe('live');
    expect(stationKind({ url: 'https://feeds.intoday.in/aajtak', name: 'Aaj Tak News Radio Live' })).toBe('live');
    expect(stationKind({ url: 'https://stream-284.surfernetwork.com/wga', name: 'Radio Mirchi Lucknow' })).toBe('live');
    expect(stationKind({ url: 'https://stream.example.com/x', name: 'Radio Foo 98.3 FM' })).toBe('live');
    expect(stationKind({ url: 'https://stream.example.com/x', name: 'Foo', homepage: 'https://allindiaradio.gov.in/Default' })).toBe('live');
  });

  it('does not label automated or unknown streams live', () => {
    expect(stationKind({ url: 'https://stream.zeno.fm/x', name: 'Hits Of Mohammed Rafi', tags: 'bollywood' })).toBe('playlist');
    expect(stationKind({ url: 'https://drive.uber.radio/x', name: 'Bollywood_Dance' })).toBe('playlist');
    expect(stationKind({ url: 'https://ice2.somafm.com/groovesalad', name: 'SomaFM Groove Salad', tags: 'ambient,chillout' })).toBeUndefined();
    expect(stationKind({ url: 'https://stream.shahimsha.com/live', name: 'Shahimsha Online radio' })).toBeUndefined();
    expect(stationKind({ url: 'http://162.244.80.118:9460/stream.mp3', name: 'Radio Mirchi masti', tags: 'music' })).toBeUndefined();
    expect(stationKind({ url: 'not a url' })).toBeUndefined();
  });
});

describe('lyrics title matching', () => {
  it('drops featured artists and version notes the lyrics database leaves out', () => {
    expect(cleanTitle('Wasted (feat. Lil Uzi Vert)')).toBe('Wasted');
    expect(cleanTitle('Lucid Dreams - Remastered 2020')).toBe('Lucid Dreams');
    expect(cleanTitle('Bandit ft. YoungBoy Never Broke Again')).toBe('Bandit');
    expect(cleanTitle('Hide [with Seezyn]')).toBe('Hide');
    expect(cleanTitle('Righteous')).toBe('Righteous');
  });
});
