import { describe, test, expect } from 'vitest';
import { capText, vttPlainText } from '../../apps/server/src/services/subtitle-text.js';
import { parseBullets, recapRequest, recapCacheKey, recapCutoff, RECAP_TEXT_CAP } from '../../apps/server/src/services/recap.js';

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

  test('caps the count, and a reply with no bullets is not a recap', () => {
    const many = Array.from({ length: 12 }, (_, i) => `- Event number ${i}`).join('\n');
    expect(parseBullets(many)).toHaveLength(8);
    // What a small model says when it mistakes the dialogue for a chat.
    expect(parseBullets("It seems like you're discussing a conversation. Can you provide more context?")).toEqual([]);
  });

  test('splits bullets run into one line, and drops lines a model repeats', () => {
    const run = 'Anna and John arrive. - Anna invites Oleg. - They plan dinner. - They plan dinner. - They plan dinner.';
    expect(parseBullets('- ' + run)).toEqual(['Anna and John arrive.', 'Anna invites Oleg.', 'They plan dinner.']);
  });

  test('puts the instruction after the dialogue, fenced off', () => {
    const req = recapRequest('Hello there.');
    expect(req.indexOf('Hello there.')).toBeLessThan(req.indexOf('Write a recap'));
    expect(req).toContain('<<<DIALOGUE');
  });
});
