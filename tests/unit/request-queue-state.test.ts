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

  test('a warning is shown with what the queue said, rather than pretending to be progress', () => {
    const mapped = requestStateForQueue('warning', 'Sample file');
    expect(mapped.status).toBe('downloading');
    expect(mapped.message).toBe('Needs attention: Sample file');
    expect(requestStateForQueue('delay').message).toMatch(/reports "delay"/);
    expect(requestStateForQueue(undefined).status).toBe('downloading');
  });

  test('a finished download that cannot be imported is an import problem, not a download', () => {
    const mapped = requestStateForQueue('warning', "Couldn't find similar album", 100);
    expect(mapped.status).toBe('importing');
    expect(mapped.message).toBe("Needs attention: Couldn't find similar album");
  });

  test('a download nobody is sending is called stalled, the same word the Downloads page uses', () => {
    for (const status of ['warning', 'error']) {
      const mapped = requestStateForQueue(status, 'The download is stalled with no connections');
      expect(mapped.status).toBe('downloading');
      expect(mapped.message).toMatch(/^Stalled: nobody is sharing this release/);
    }
  });
});
