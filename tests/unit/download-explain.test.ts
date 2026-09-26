import { describe, expect, it } from 'vitest';
import { explainTrouble } from '../../apps/web/src/lib/download-explain.js';

const now = Date.UTC(2026, 8, 26, 12, 0, 0);
const entry = (o: object) => ({ id: 'a', title: 't', kind: 'stalled' as const, since: '', fixAt: null, gaveUp: false, needsYou: null, ...o });

describe('explaining stuck downloads', () => {
  it('says nobody is sharing it and when it replaces itself', () => {
    const e = explainTrouble({ status: 'stalled', message: 'The download is stalled with no connections' }, entry({ fixAt: new Date(now + 25 * 60_000).toISOString() }), now);
    expect(e?.text).toBe('Nobody is sharing this file right now. It is replaced automatically in about 25 minutes.');
    expect(explainTrouble({ status: 'stalled' }, entry({ fixAt: new Date(now + 30_000).toISOString() }), now)?.text).toMatch(/in a moment/);
    expect(explainTrouble({ status: 'stalled' }, entry({ fixAt: new Date(now + 3 * 3_600_000).toISOString() }), now)?.text).toMatch(/in about 3 hours/);
  });

  it('offers the manual button when nothing will happen by itself, and points to the next step after giving up', () => {
    expect(explainTrouble({ status: 'stalled' }, undefined, now)?.text).toMatch(/Try another release/);
    expect(explainTrouble({ status: 'stalled' }, entry({ gaveUp: true }), now)?.text).toMatch(/pick a release by hand/);
  });

  it('says what an unmatched import is and what needs a person', () => {
    expect(explainTrouble({ status: 'failed', message: "Couldn't find similar album" }, entry({ kind: 'import', fixAt: new Date(now + 600_000).toISOString() }), now)?.text).toMatch(/could not be matched to the title/);
    expect(explainTrouble({ status: 'failed' }, entry({ kind: 'other', needsYou: 'Free some disk space.' }), now)).toEqual({ tone: 'bad', text: 'Free some disk space.' });
    expect(explainTrouble({ status: 'downloading' }, undefined, now)).toBeNull();
  });
});
