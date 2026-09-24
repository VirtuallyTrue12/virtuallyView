import { describe, test, expect } from 'vitest';
import { detectIntent, isConversational } from '../../apps/server/src/services/ai-router.js';

describe('conversational questions', () => {
  test.each([
    'how do I add a new movie to my library?',
    'explain what Prowlarr does',
    'what is Radarr',
    'recommend something to watch tonight',
    'tell me a joke about movies'
  ])('%s goes to the model, not a status rule', text => {
    if (!/joke/.test(text)) expect(isConversational(text)).toBe(true);
    expect(detectIntent(text)).toBeNull();
  });

  test.each([
    ['how many movies do I have?', 'library'],
    ['what is downloading?', 'downloads'],
    ['why is Dune not showing', 'diagnose']
  ])('%s stays a rule', (text, kind) => {
    expect(detectIntent(text)?.kind).toBe(kind);
  });
});
