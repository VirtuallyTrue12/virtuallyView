import { describe, expect, it } from 'vitest';
import { parseByteRange } from '../../apps/server/src/lib/byte-range';

const SIZE = 4_194_304; // 4 MiB

describe('byte-range parsing (RFC 9110 §14.1.2)', () => {
  it('a normal range', () => {
    expect(parseByteRange('bytes=500-999', SIZE)).toEqual({ start: 500, end: 999 });
  });

  it('a suffix range ("bytes=-500") is the LAST 500 bytes, not bytes 0-500', () => {
    expect(parseByteRange('bytes=-500', SIZE)).toEqual({ start: SIZE - 500, end: SIZE - 1 });
  });

  it('a suffix longer than the file just means the whole file', () => {
    expect(parseByteRange('bytes=-999999999', SIZE)).toEqual({ start: 0, end: SIZE - 1 });
  });

  it('an open-ended range ("bytes=500-") gives the rest of the file by default', () => {
    expect(parseByteRange('bytes=500-', SIZE)).toEqual({ start: 500, end: SIZE - 1 });
  });

  it('an explicit end past the end of the file is clamped, not rejected', () => {
    expect(parseByteRange(`bytes=0-${SIZE + 1000}`, SIZE)).toEqual({ start: 0, end: SIZE - 1 });
  });

  it('refuses a start at or past the end of the file, and garbage', () => {
    expect(parseByteRange(`bytes=${SIZE}-`, SIZE)).toBeNull();
    expect(parseByteRange('bytes=-', SIZE)).toBeNull();
    expect(parseByteRange('nonsense', SIZE)).toBeNull();
    expect(parseByteRange('bytes=abc-def', SIZE)).toBeNull();
  });
});
