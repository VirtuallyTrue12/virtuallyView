import { describe, expect, it } from 'vitest';
import { parseTranslation } from '../../apps/server/src/services/lyrics-translate';

describe('lyrics translation reply', () => {
  it('takes exactly one translated line per sung line, in order', () => {
    expect(parseTranslation('{"lines": ["Hola", "Adiós"]}', 2)).toEqual(['Hola', 'Adiós']);
  });

  it('accepts the JSON inside a code fence', () => {
    expect(parseTranslation('```json\n{"lines": ["Bonjour"]}\n```', 1)).toEqual(['Bonjour']);
  });

  it('refuses a reply with the wrong number of lines, so the timing never drifts', () => {
    expect(parseTranslation('{"lines": ["one", "two"]}', 3)).toBeNull();
    expect(parseTranslation('{"lines": ["one", "two", "three", "four"]}', 3)).toBeNull();
  });

  it('refuses a reply that is not the expected shape', () => {
    expect(parseTranslation('Sure! Here it is.', 1)).toBeNull();
    expect(parseTranslation('{"lines": [1, 2]}', 2)).toBeNull();
    expect(parseTranslation('{"text": "x"}', 1)).toBeNull();
  });
});
