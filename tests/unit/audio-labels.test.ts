import { describe, it, expect } from 'vitest';
import { audioLabels, languageFromCode } from '../../apps/web/src/lib/media-info.js';

const info = (tracks: Array<{ codec: string; language: string; title?: string; channels: number | null }>) => ({
  playable: true, container: 'mkv', videoCodec: 'h264', audioCodec: 'aac', durationSeconds: 100, reason: null, transcodingAvailable: true,
  audioTracks: tracks.map((t, index) => ({ index, title: '', ...t }))
});

describe('audio track names', () => {
  it('names each track by its language, not by the release group in its title tag', () => {
    const labels = audioLabels(info([
      { codec: 'aac', language: 'eng', title: 'KIN', channels: 2 }, { codec: 'aac', language: 'hin', title: 'KIN', channels: 2 },
      { codec: 'aac', language: 'tam', title: 'KIN', channels: 2 }, { codec: 'aac', language: 'tel', title: 'KIN', channels: 2 }
    ]));
    expect(labels.map(l => l.label)).toEqual(['English · Stereo · AAC', 'Hindi · Stereo · AAC', 'Tamil · Stereo · AAC', 'Telugu · Stereo · AAC']);
  });

  it('uses friendly codec and layout names, and keeps a note that helps', () => {
    const labels = audioLabels(info([
      { codec: 'eac3', language: 'eng', channels: 6 }, { codec: 'ac3', language: 'fre', channels: 6 },
      { codec: 'aac', language: 'eng', title: 'Director Commentary', channels: 2 }, { codec: 'truehd', language: 'ger', channels: 8 }
    ])).map(l => l.label);
    expect(labels).toEqual(['English · 5.1 · Dolby Digital Plus', 'French · 5.1 · Dolby Digital', 'English (Commentary) · Stereo · AAC', 'German · 7.1 · Dolby TrueHD']);
  });

  it('falls back to the title for a missing language, and numbers tracks that would read the same', () => {
    expect(audioLabels(info([{ codec: 'aac', language: 'und', title: 'Hindi 5.1', channels: 6 }, { codec: 'aac', language: 'und', title: 'Whatever', channels: 2 }])).map(l => l.label))
      .toEqual(['Hindi · 5.1 · AAC', 'Track 2 · Stereo · AAC']);
    expect(audioLabels(info([{ codec: 'aac', language: 'eng', channels: 2 }, { codec: 'aac', language: 'eng', channels: 2 }])).map(l => l.label))
      .toEqual(['English · Stereo · AAC (1)', 'English · Stereo · AAC (2)']);
  });

  it('understands old three-letter codes and ignores meaningless ones', () => {
    expect(languageFromCode('ger')).toBe('German');
    expect(languageFromCode('chi')).toBe('Chinese');
    expect(languageFromCode('und')).toBe('');
  });
});
