import { describe, expect, it } from 'vitest';
import { tvContentType } from '../../apps/server/src/routes/cast.js';

describe('which files the TV plays as they are', () => {
  it('sends common TV formats directly, so the TV remote can seek', () => {
    expect(tvContentType({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'aac' })).toBe('video/x-matroska');
    expect(tvContentType({ container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' })).toBe('video/mp4');
  });

  it('converts what the TV cannot decode', () => {
    expect(tvContentType({ container: 'mkv', videoCodec: 'h264', audioCodec: 'dts' })).toBeNull();
    expect(tvContentType({ container: 'avi', videoCodec: 'mpeg4', audioCodec: 'mp3' })).toBeNull();
    expect(tvContentType({ container: 'mkv', videoCodec: 'mpeg2video', audioCodec: 'aac' })).toBeNull();
    // Dolby audio is silent on the Cast player; two tracks would always play the first (here French).
    expect(tvContentType({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'eac3' })).toBeNull();
    expect(tvContentType({ container: 'mkv', videoCodec: 'hevc', audioCodec: 'aac', audioTracks: [{}, {}] })).toBeNull();
  });
});
