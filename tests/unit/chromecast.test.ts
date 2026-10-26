import { describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage } from '../../apps/server/src/services/chromecast.js';

describe('Google Cast messages', () => {
  it('frames a message the receiver can read back', () => {
    const frame = encodeMessage('sender-vv', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', { type: 'LAUNCH', appId: 'CC1AD845', requestId: 1 });
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
    const back = decodeMessage(frame.subarray(4));
    expect(back.namespace).toBe('urn:x-cast:com.google.cast.receiver');
    expect(back.data).toEqual({ type: 'LAUNCH', appId: 'CC1AD845', requestId: 1 });
  });

  it('handles payloads longer than 127 bytes (multi-byte lengths)', () => {
    const title = 'x'.repeat(400);
    const back = decodeMessage(encodeMessage('a', 'b', 'urn:x-cast:com.google.cast.media', { title }).subarray(4));
    expect(back.data.title).toBe(title);
  });
});
