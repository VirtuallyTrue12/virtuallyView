import { describe, expect, it } from 'vitest';
import { stationKind } from '../../apps/server/src/services/radio';
import { cleanTitle } from '../../apps/server/src/routes/lyrics';
import { wav } from '../../apps/server/src/services/tts';

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

  it('leaves unknown stations without a label', () => {
    expect(stationKind({ url: 'https://stream.shahimsha.com/live', name: 'Shahimsha Online radio' })).toBeUndefined();
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

describe('spoken lines', () => {
  it('wraps raw voice samples in a playable WAV header', () => {
    const out = wav(Buffer.alloc(100), 22050, 2, 1);
    expect(out.length).toBe(144);
    expect(out.subarray(0, 4).toString()).toBe('RIFF');
    expect(out.readUInt32LE(24)).toBe(22050);
    expect(out.readUInt32LE(40)).toBe(100);
  });
});
