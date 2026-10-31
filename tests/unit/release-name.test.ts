import { describe, expect, it } from 'vitest';
import { releaseName } from '../../apps/web/src/components/layout/NotificationBell.js';

describe('download names in the bell', () => {
  it('reads like a title, not a file name', () => {
    expect(releaseName('Premature.2014.1080p.BluRay.x264-GROUP')).toBe('Premature 2014');
    expect(releaseName('How.I.Met.Your.Mother.S06E04.1080p.WEB-DL')).toBe('How I Met Your Mother S06E04');
    expect(releaseName('Knowing (2009) [1080p] [BluRay]')).toBe('Knowing (2009)');
    expect(releaseName('Juice WRLD - Legends Never Die')).toBe('Juice WRLD - Legends Never Die');
  });
});
