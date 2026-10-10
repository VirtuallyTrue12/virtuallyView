import { afterEach, describe, expect, it, vi } from 'vitest';
import { NZBGetAdapter } from '../../packages/integrations/src/adapters/NZBGetAdapter';

const rpcReply = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function adapter() {
  const a = new NZBGetAdapter();
  await a.connect({ url: 'http://nzbget:6789', apiKey: 'user:pass' });
  return a;
}

afterEach(() => vi.unstubAllGlobals());

describe('NZBGet', () => {
  it('reports real progress from listgroups (FileSizeMB / RemainingSizeMB), not always 0%', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rpcReply([{ NZBID: 7, NZBName: 'Show.S01', Status: 'DOWNLOADING', FileSizeMB: 1000, RemainingSizeMB: 250 }])));
    const [row] = await (await adapter()).getQueue();
    expect(row!.progress).toBe(75);
  });

  it('removes by sending the numeric id as the third editqueue argument', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => { calls.push(JSON.parse(String(init?.body))); return rpcReply(true); }));
    const result = await (await adapter()).remove('7');
    expect(result.success).toBe(true);
    expect((calls[0] as { method: string; params: unknown[] })).toMatchObject({ method: 'editqueue', params: ['GroupDelete', '', [7]] });
  });

  it('says so when NZBGet refuses the removal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rpcReply(false)));
    expect((await (await adapter()).remove('7')).success).toBe(false);
  });
});
