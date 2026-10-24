import { describe, expect, it } from 'vitest';
import { spreadShuffle } from '../../apps/web/src/components/media/MusicProvider';

describe('shuffle across artists', () => {
  it('keeps every track and never puts the same artist twice in a row when it can avoid it', () => {
    const tracks = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, artistTitle: 'Metallica' })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `j${i}`, artistTitle: 'Juice WRLD' })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, artistTitle: 'Daft Punk' }))
    ];
    for (let run = 0; run < 25; run++) {
      const out = spreadShuffle(tracks);
      expect(out.map(t => t.id).sort()).toEqual(tracks.map(t => t.id).sort());
      const repeats = out.filter((t, i) => i > 0 && t.artistTitle === out[i - 1]!.artistTitle).length;
      expect(repeats).toBe(0);
    }
  });

  it('copes with one artist only, and with nothing', () => {
    expect(spreadShuffle([{ artistTitle: 'A' }, { artistTitle: 'A' }])).toHaveLength(2);
    expect(spreadShuffle([])).toEqual([]);
  });
});
