import { describe, test, expect } from 'vitest';
import { capText, vttPlainText } from '../../apps/server/src/services/subtitle-text.js';
import { parseBullets, recapCacheKey, recapCutoff, RECAP_TEXT_CAP } from '../../apps/server/src/services/recap.js';

const VTT = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello there.

00:00:20.000 --> 00:00:22.000
<i>The door opens.</i>

00:01:05.000 --> 00:01:08.000
Nobody knows yet.

00:08:20.000 --> 00:08:22.000
Late reveal.
`;

describe('subtitle text cutoff', () => {
  test('keeps only the cues that start before the cutoff', () => {
    expect(vttPlainText(VTT, 60)).toBe('Hello there.\nThe door opens.');
    expect(vttPlainText(VTT, 61)).toBe('Hello there.\nThe door opens.');
    expect(vttPlainText(VTT, 66)).toBe('Hello there.\nThe door opens.\nNobody knows yet.');
  });

  test('keeps every cue when there is no cutoff, without tags or repeated lines', () => {
    const text = vttPlainText(VTT.replace('Nobody knows yet.', 'The door opens.'));
    expect(text).toBe('Hello there.\nThe door opens.\nLate reveal.');
  });
});

describe('recap text cap', () => {
  test('keeps the newest lines when the text is longer than the cap', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    const capped = capText(text, RECAP_TEXT_CAP);
    expect(capped.length).toBeLessThanOrEqual(RECAP_TEXT_CAP);
    expect(capped.endsWith('line 1999')).toBe(true);
    // Starts at a whole line, not in the middle of one.
    expect(capped.startsWith('line ')).toBe(true);
  });

  test('leaves short text alone', () => {
    expect(capText('short text', RECAP_TEXT_CAP)).toBe('short text');
  });
});

describe('recap cache keying', () => {
  test('one key per item and five-minute step', () => {
    expect(recapCutoff(310)).toBe(300);
    expect(recapCacheKey('episode', 'episode-1', 301)).toBe(recapCacheKey('episode', 'episode-1', 599));
    expect(recapCacheKey('episode', 'episode-1', 599)).not.toBe(recapCacheKey('episode', 'episode-1', 600));
    expect(recapCacheKey('episode', 'episode-1', 600)).not.toBe(recapCacheKey('episode', 'episode-2', 600));
    expect(recapCacheKey('movie', 'episode-1', 600)).not.toBe(recapCacheKey('episode', 'episode-1', 600));
  });

  test('the cutoff rounds down, so an answer never reaches past the viewer', () => {
    expect(recapCutoff(-5)).toBe(0);
    expect(recapCutoff(Number.NaN)).toBe(0);
    expect(recapCutoff(599.9)).toBe(300);
  });
});

describe('recap bullets', () => {
  test('reads bullet lines and ignores chatter around them', () => {
    expect(parseBullets('Here is the recap:\n- Mara leaves the city.\n- The bridge falls.')).toEqual([
      'Mara leaves the city.',
      'The bridge falls.'
    ]);
  });

  test('falls back to plain lines when no bullets are used, and caps the count', () => {
    const plain = Array.from({ length: 12 }, (_, i) => `Event number ${i}`).join('\n');
    expect(parseBullets(plain)).toHaveLength(8);
  });
});
