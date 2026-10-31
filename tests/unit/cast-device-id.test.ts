import { describe, expect, it } from 'vitest';
import { castDevice } from '../../apps/server/src/services/dlna.js';

describe('a TV found again after a power cut', () => {
  it('keeps its id when the router gives it a new address', () => {
    const before = castDevice('192.168.0.109', 'Living Room TV', 'uuid:c714f872');
    const after = castDevice('192.168.0.142', 'Living Room TV', 'uuid:c714f872');
    expect(after.id).toBe(before.id);
    expect(after.host).toBe('192.168.0.142');
  });

  it('tells two TVs apart', () => {
    expect(castDevice('192.168.0.5', 'TV', 'uuid:a').id).not.toBe(castDevice('192.168.0.6', 'TV', 'uuid:b').id);
  });
});
