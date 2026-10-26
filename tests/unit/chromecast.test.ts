import { describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage } from '../../apps/server/src/services/chromecast.js';

const NS_MEDIA = 'urn:x-cast:com.google.cast.media';
const NS_RECV = 'urn:x-cast:com.google.cast.receiver';

describe('Google Cast messages', () => {
  it('frames a message the receiver can read back', () => {
    const frame = encodeMessage('sender-vv', 'receiver-0', NS_RECV, { type: 'LAUNCH', appId: 'CC1AD845', requestId: 1 });
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
    const back = decodeMessage(frame.subarray(4));
    expect(back.namespace).toBe(NS_RECV);
    expect(back.data).toEqual({ type: 'LAUNCH', appId: 'CC1AD845', requestId: 1 });
  });

  it('handles payloads longer than 127 bytes (multi-byte lengths)', () => {
    const title = 'x'.repeat(400);
    const back = decodeMessage(encodeMessage('a', 'b', NS_MEDIA, { title }).subarray(4));
    expect(back.data.title).toBe(title);
  });

  it('GET_STATUS request has correct shape for status polling', () => {
    const frame = encodeMessage('sender-vv', 'transport-abc', NS_MEDIA, { type: 'GET_STATUS', requestId: 2 });
    const back = decodeMessage(frame.subarray(4));
    expect(back.namespace).toBe(NS_MEDIA);
    expect(back.data.type).toBe('GET_STATUS');
    expect(back.data.requestId).toBe(2);
  });

  it('SEEK payload includes currentTime', () => {
    const frame = encodeMessage('sender-vv', 'transport-abc', NS_MEDIA, { type: 'SEEK', mediaSessionId: 5, requestId: 3, currentTime: 123.4 });
    const back = decodeMessage(frame.subarray(4));
    expect(back.data.type).toBe('SEEK');
    expect(back.data.currentTime).toBe(123.4);
    expect(back.data.mediaSessionId).toBe(5);
  });

  it('LOAD with subtitle track encodes tracks and activeTrackIds', () => {
    const payload = {
      type: 'LOAD', requestId: 2, autoplay: true,
      media: { contentId: 'http://server/stream', contentType: 'video/mp4', streamType: 'BUFFERED', metadata: { metadataType: 1, title: 'Film' }, tracks: [{ trackId: 1, type: 'TEXT', trackContentId: 'http://server/sub.vtt', trackContentType: 'text/vtt', subtype: 'SUBTITLES', name: 'English', language: 'en' }] },
      activeTrackIds: [1]
    };
    const back = decodeMessage(encodeMessage('sender-vv', 'transport-xyz', NS_MEDIA, payload).subarray(4));
    expect(back.data.type).toBe('LOAD');
    expect((back.data.activeTrackIds as number[])).toEqual([1]);
  });
});
