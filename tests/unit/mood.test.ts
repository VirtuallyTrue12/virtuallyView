import { describe, expect, it } from 'vitest';
import { moodFromEnergy, songMood } from '../../apps/web/src/lib/mood';

const lines = (...l: string[]) => l;

describe('reading a song’s feeling', () => {
  it('hears sadness first, even in a love song', () => {
    expect(songMood({ title: 'Gone', lyrics: lines('I cry alone tonight', 'my love is gone and I am broken', 'tears and pain', 'empty room', 'lonely again') })).toBe('sad');
  });
  it('hears a love song', () => {
    expect(songMood({ title: 'You and Me', lyrics: lines('I love you darling', 'hold me close forever', 'kiss me, my love', 'you and me together', 'beautiful tonight') })).toBe('romantic');
  });
  it('hears a party', () => {
    expect(songMood({ title: 'Tonight', lyrics: lines('let\'s go, turn up the party', 'dance all night in the club', 'jump, bounce, go wild', 'turn it up loud', 'party') })).toBe('energetic');
  });
  it('hears an uplifting song', () => {
    expect(songMood({ title: 'Sunshine', lyrics: lines('the sun will shine again', 'I feel alive and free', 'rise up, fly higher', 'dreams and hope', 'happy smile') })).toBe('uplifting');
  });
  it('says nothing when the words are neutral, and goes by the energy instead', () => {
    expect(songMood({ title: 'Track 7', lyrics: lines('we went down the road', 'then took the car to town', 'and talked about the weather', 'went home after that') })).toBeNull();
    expect(moodFromEnergy(0.5)).toBe('energetic');
    expect(moodFromEnergy(0.35)).toBe('uplifting');
    expect(moodFromEnergy(0.1)).toBe('calm');
  });
  it('uses the genre as a hint', () => {
    expect(songMood({ title: 'Untitled', genres: ['Ambient'], lyrics: lines('slow and easy', 'breathe') })).toBe('calm');
  });
});
