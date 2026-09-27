import { describe, expect, it } from 'vitest';
import { contentTypeFor } from '../../apps/server/src/routes/stream.js';

describe('direct-play Content-Type', () => {
  it('gives Safari and strict browsers a real video type for every extension the library scanner accepts', () => {
    expect(contentTypeFor('/media/movies/Dune (2021)/Dune.2021.1080p.m4v')).toBe('video/mp4');
    expect(contentTypeFor('/media/movies/x.mp4')).toBe('video/mp4');
    expect(contentTypeFor('/media/movies/x.mkv')).toBe('video/x-matroska');
    expect(contentTypeFor('/media/movies/x.avi')).toBe('video/x-msvideo');
    expect(contentTypeFor('/media/movies/x.wmv')).toBe('video/x-ms-wmv');
    expect(contentTypeFor('/media/movies/x.ts')).toBe('video/mp2t');
    expect(contentTypeFor('/media/movies/x.m2ts')).toBe('video/mp2t');
    expect(contentTypeFor('/media/movies/x.mpg')).toBe('video/mpeg');
  });
  it('falls back plainly for an extension nothing recognises', () => {
    expect(contentTypeFor('/media/movies/x.bin')).toBe('application/octet-stream');
  });
});
