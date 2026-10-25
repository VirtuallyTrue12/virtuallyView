import { describe, expect, it } from 'vitest';
import { DjBrain, QUIET_START, sadness, type DjSong } from '../../apps/web/src/lib/dj-brain';

const song = (title: string, extra: Partial<DjSong> = {}): DjSong => ({ title, artist: 'Artist A', ...extra });
// A fixed sequence of "random" numbers, so the tests are repeatable.
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]!; };
const noon = new Date('2026-10-25T12:20:00');

/** Plays `count` songs through the brain and returns how many breaks it would have spoken. */
function run(brain: DjBrain, songs: DjSong[]): (string | null)[] {
  const said: (string | null)[] = [];
  for (let i = 0; i < songs.length - 1; i++) {
    const b = brain.plan(songs[i + 1]!, [], noon, songs[i]);
    brain.noteSong(songs[i]!);
    said.push(b?.text ?? null);
    if (b) brain.commit(b, noon.getTime());
  }
  return said;
}

describe('DJ: when to talk', () => {
  it('stays quiet for the first few songs of a session', () => {
    const brain = new DjBrain('chatty', seq(0.99), noon.getTime());
    const said = run(brain, Array.from({ length: QUIET_START + 1 }, (_, i) => song(`Song ${i}`)));
    expect(said.slice(0, QUIET_START - 1).every(s => s === null)).toBe(true);
  });

  it('talks every few songs, not after every one', () => {
    const brain = new DjBrain('balanced', seq(0.99, 0.5, 0.99), noon.getTime());
    const said = run(brain, Array.from({ length: 30 }, (_, i) => song(`Song ${i}`, { artist: `Artist ${i % 5}` })));
    const breaks = said.filter(Boolean).length;
    expect(breaks).toBeGreaterThan(4);
    expect(breaks).toBeLessThan(14);
    // Never two breaks in a row.
    for (let i = 1; i < said.length; i++) expect(!!said[i] && !!said[i - 1]).toBe(false);
  });

  it('talks rarely on minimal', () => {
    const brain = new DjBrain('minimal', seq(0.99, 0.5), noon.getTime());
    const said = run(brain, Array.from({ length: 30 }, (_, i) => song(`Song ${i}`, { artist: `Artist ${i % 5}` })));
    expect(said.filter(Boolean).length).toBeLessThan(8);
  });
});

describe('DJ: what to say', () => {
  it('looks back over the songs since the last break', () => {
    const brain = new DjBrain('balanced', seq(0.99), noon.getTime());
    const songs = ['One', 'Two', 'Three', 'Four', 'Five'].map(t => song(t, { artist: `X ${t}` }));
    const said = run(brain, songs).filter(Boolean) as string[];
    expect(said[0]).toMatch(/Three|Two/);
    expect(said[0]).toMatch(/Four|Five/);
  });

  it('gives a soft, kind word after a run of sad songs', () => {
    const brain = new DjBrain('minimal', seq(0.1), noon.getTime());
    const sad = (t: string) => song(t, { lyrics: ['I cry alone, so lonely tonight', 'tears and pain, I miss you', 'empty and broken'] });
    for (const t of ['A', 'B', 'C']) brain.noteSong(sad(t));
    const b = brain.plan(song('Next'), [], noon, sad('D'));
    expect(b?.soft).toBe(true);
    expect(b?.reason).toBe('mood');
  });

  it('mentions a long run of one genre', () => {
    const brain = new DjBrain('minimal', seq(0.1), noon.getTime());
    for (const t of ['A', 'B', 'C', 'D']) brain.noteSong(song(t, { genres: ['Hip Hop'] }));
    const b = brain.plan(song('Next', { genres: ['Hip Hop'] }), [], noon, song('E', { genres: ['Hip Hop'] }));
    expect(b?.reason).toBe('genre');
    expect(b?.text).toMatch(/hip hop/);
  });

  it('never repeats the same sentence back to back', () => {
    const brain = new DjBrain('chatty', Math.random, noon.getTime());
    const said = run(brain, Array.from({ length: 60 }, () => song('Song', { artist: 'Same' }))).filter(Boolean);
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1]);
  });
});

describe('DJ: reading the mood', () => {
  it('scores sad lyrics high and happy ones low', () => {
    expect(sadness(song('x', { lyrics: ['I cry alone at night', 'all this pain, I am broken', 'tears on the grave'] }))).toBeGreaterThan(0.45);
    expect(sadness(song('x', { lyrics: ['dance all night', 'sun is shining, feeling good', 'party with my friends'] }))).toBeLessThan(0.2);
    expect(sadness(song('Lonely'))).toBeGreaterThan(0.45);
  });
});
