import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const dir = mkdtempSync(resolve(tmpdir(), 'vv-remove-'));
process.env.VV_DATA_DIR = dir;

const now = new Date().toISOString();
const req = (o: object) => JSON.stringify({ status: 'searching', service: 'sonarr', mediaType: 'series', createdAt: now, updatedAt: now, ...o });

let remove: typeof import('../../apps/server/src/services/remove-title.js');
let requests: typeof import('../../apps/server/src/services/requests.js');
let media: typeof import('../../apps/server/src/routes/media.js');

beforeAll(async () => {
  const db = await import('../../apps/server/src/db/app-db.js');
  db.run('INSERT INTO requests (id, payload, updated_at) VALUES (?, ?, ?)', 'request-110', req({ id: 'request-110', title: 'The Vampire Diaries', year: 2009, selectedProviderId: '95491', providerId: 'sonarr-3', metadataProvider: 'tvdb' }), now);
  db.run('INSERT INTO requests (id, payload, updated_at) VALUES (?, ?, ?)', 'request-111', req({ id: 'request-111', title: 'Never Reached Sonarr', year: 2020, selectedProviderId: '777' }), now);
  requests = await import('../../apps/server/src/services/requests.js');
  remove = await import('../../apps/server/src/services/remove-title.js');
  media = await import('../../apps/server/src/routes/media.js');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const fakeArr = (queue: Array<{ id: string; mediaId: string }>, removeResult = { success: true, message: 'ok' }) => {
  const removedQueue: string[] = [];
  return {
    removedQueue, removedIds: [] as string[],
    getQueue: async () => queue,
    removeQueueItem: async (id: string) => { removedQueue.push(id); return { success: true, message: 'ok' }; },
    remove: vi.fn(async function (this: { removedIds: string[] }, id: string) { return removeResult; })
  };
};

describe('removing a title that is still downloading', () => {
  it('maps a request id to the library id behind it', () => {
    expect(remove.libraryIdFor('request-110')).toEqual({ libraryId: 'sonarr-3', requestIds: ['request-110'] });
    expect(remove.libraryIdFor('sonarr-3').libraryId).toBe('sonarr-3');
    expect(remove.libraryIdFor('sonarr-3').requestIds).toEqual(['request-110']);
    expect(remove.libraryIdFor('request-111')).toEqual({ libraryId: null, requestIds: ['request-111'] });
  });

  it('does not show a second, placeholder row for a show that is already in the library', () => {
    const library = [{ id: 'sonarr-3', title: 'Vampire Diaries', year: 2009, type: 'series', status: 'missing', provider: { id: 3, metadata: { tvdbId: 95491 } } }];
    const merged = media.mergeRequests(library as never, 'series');
    expect(merged.map(m => m.id).sort()).toEqual(['request-111', 'sonarr-3']);
    expect(merged.find(m => m.id === 'sonarr-3')?.status).toBe('requested');
  });

  it('stops its downloads, removes the show by its library id, and drops the requests that pointed at it', async () => {
    const arr = fakeArr([{ id: 'queue-41', mediaId: 'sonarr-3' }, { id: 'queue-42', mediaId: 'sonarr-3' }, { id: 'queue-43', mediaId: 'sonarr-9' }]);
    // The client also holds torrents the media manager's (partial) queue view does not list.
    const acted: string[] = [];
    const deps = {
      downloads: async () => [
        { id: 'queue-qbittorrent-aaa', mediaId: 'sonarr-3', sourceClient: 'qbittorrent' }, { id: 'queue-qbittorrent-bbb', mediaId: 'sonarr-3', sourceClient: 'qbittorrent' },
        { id: 'queue-qbittorrent-ccc', mediaId: 'sonarr-9', sourceClient: 'qbittorrent' }, { id: 'queue-sonarr-41', mediaId: 'sonarr-3', sourceClient: 'sonarr' }
      ],
      act: async (id: string, action: string) => { acted.push(`${id}:${action}`); return { success: true, message: 'ok' }; }
    };
    const result = await remove.removeTitle(arr as never, 'request-110', true, deps);
    expect(result).toEqual({ success: true, message: 'Removed, and 4 downloads stopped.' });
    expect(acted.sort()).toEqual(['queue-qbittorrent-aaa:delete-files', 'queue-qbittorrent-bbb:delete-files']);
    expect(arr.removedQueue.sort()).toEqual(['41', '42']);
    expect(arr.remove).toHaveBeenCalledWith('sonarr-3', true);
    expect(requests.getRequest('request-110')).toBeUndefined();
  });

  it('keeps the request when the media manager refuses, and removes a request that never reached it', async () => {
    const refusing = fakeArr([], { success: false, message: 'Sonarr could not remove the series (status 500).' });
    requests.getRequests();
    const failed = await remove.removeTitle(refusing as never, 'sonarr-3', false, { downloads: async () => [{ id: 'queue-qbittorrent-zzz', mediaId: 'sonarr-3', sourceClient: 'qbittorrent' }], act: async () => { throw new Error('must not touch the client when the removal was refused'); } });
    expect(failed.success).toBe(false);

    const none = fakeArr([]);
    const result = await remove.removeTitle(none as never, 'request-111', false, { downloads: async () => [], act: async () => ({ success: true, message: '' }) });
    expect(result.success).toBe(true);
    expect(none.remove).not.toHaveBeenCalled();
    expect(requests.getRequest('request-111')).toBeUndefined();
  });
});
