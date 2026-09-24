import { describe, test, expect } from 'vitest';
import { requestStateForQueue } from '../../apps/server/src/services/requests.js';

describe('what a queue row means for its request', () => {
  test.each([
    ['downloading', 'downloading', undefined],
    ['queued', 'downloading', /waiting/i],
    ['paused', 'downloading', /paused/i],
    ['importing', 'importing', undefined],
    ['completed', 'importing', undefined]
  ])('%s -> %s', (queue, status, message) => {
    const mapped = requestStateForQueue(queue);
    expect(mapped.status).toBe(status);
    if (message) expect(mapped.message).toMatch(message); else expect(mapped.message).toBeUndefined();
  });

  test('a failed download sends the request back to searching and says why', () => {
    const mapped = requestStateForQueue('failed', 'No files found');
    expect(mapped.status).toBe('searching');
    expect(mapped.message).toMatch(/failed: No files found/);
  });

  test('unknown statuses are shown as reported rather than pretending to be progress', () => {
    const mapped = requestStateForQueue('warning', 'Sample file');
    expect(mapped.status).toBe('downloading');
    expect(mapped.message).toMatch(/reports "warning"/);
    expect(requestStateForQueue(undefined).status).toBe('downloading');
  });
});
