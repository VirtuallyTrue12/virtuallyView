import { describe, expect, it } from 'vitest';
import { fanOut, type SourceResult } from '../../apps/server/src/services/search-everything';

describe('one search box fans out to every source', () => {
  it('reports fast sources first, and a failing or too-slow source never holds the rest up', async () => {
    const seen: SourceResult[] = [];
    const started = Date.now();
    await fanOut([
      { name: 'slow', timeoutMs: 1000, run: () => new Promise(r => setTimeout(() => r({ videos: [1] }), 80)) },
      { name: 'fast', timeoutMs: 1000, run: async () => ({ library: [1, 2] }) },
      { name: 'broken', timeoutMs: 1000, run: async () => { throw new Error('offline'); } },
      { name: 'stuck', timeoutMs: 50, run: () => new Promise(() => undefined) }
    ], r => seen.push(r));
    expect(seen.map(r => r.source)).toEqual(['fast', 'broken', 'stuck', 'slow']);
    expect(seen.find(r => r.source === 'fast')).toEqual({ source: 'fast', ok: true, data: { library: [1, 2] } });
    expect(seen.find(r => r.source === 'broken')?.ok).toBe(false);
    expect(seen.find(r => r.source === 'stuck')?.ok).toBe(false);
    expect(seen.find(r => r.source === 'slow')?.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
