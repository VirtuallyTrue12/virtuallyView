import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseReleaseCredits } from '../../apps/server/src/services/musicbrainz-credits';

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/musicbrainz-release.json'), 'utf8')) as unknown;

describe('MusicBrainz credits', () => {
  it('reads writers, producers and performers for each track from the release', () => {
    const credits = parseReleaseCredits(fixture);
    expect(credits).not.toBeNull();
    expect(credits!.tracks.map(t => [t.position, t.title])).toEqual([[1, 'First Song'], [2, 'Second Song']]);

    const first = credits!.tracks[0]!;
    expect(first.writers).toEqual(['Casey Composer', 'Lee Lyricist']);
    expect(first.producers).toEqual(['Pat Producer']);
    // The band from the artist credit, then the singer and the guitarist. The mixer is not a performer here.
    expect(first.performers).toEqual(['Test Band', 'Sam Singer', 'Gina Guitar']);

    const second = credits!.tracks[1]!;
    expect(second.writers).toEqual(['Dee Writer']);
    expect(second.producers).toEqual(['Pat Producer']);
    expect(second.performers).toEqual(['Test Band']);
  });

  it('gathers the album-level names without repeats', () => {
    const credits = parseReleaseCredits(fixture)!;
    expect(credits.writers).toEqual(['Casey Composer', 'Lee Lyricist', 'Dee Writer']);
    expect(credits.producers).toEqual(['Pat Producer']);
    expect(credits.performers).toEqual(['Test Band', 'Sam Singer', 'Gina Guitar']);
  });

  it('returns null for a release with no tracks, so the page says there are no credits', () => {
    expect(parseReleaseCredits({ id: 'x', media: [] })).toBeNull();
    expect(parseReleaseCredits({})).toBeNull();
    expect(parseReleaseCredits(null)).toBeNull();
  });

  it('copes with a track that has no credits at all', () => {
    const sparse = { media: [{ tracks: [{ position: 1, title: 'Bare', recording: { title: 'Bare' } }] }] };
    expect(parseReleaseCredits(sparse)).toEqual({
      tracks: [{ position: 1, title: 'Bare', writers: [], producers: [], performers: [] }],
      writers: [],
      producers: [],
      performers: []
    });
  });
});
