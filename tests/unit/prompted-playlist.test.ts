import { describe, expect, it } from 'vitest';
import {
  candidateLines,
  keywordPlaylist,
  parsePlaylistReply,
  promptWords,
  sampleCandidates,
  excludedWords,
  PLAYLIST_MAX
} from '../../apps/server/src/services/prompted-playlist';
import type { CatalogTrack } from '../../apps/server/src/services/music-mixes';

const track = (trackId: string, title: string, artistTitle: string, genre: string, artistId = artistTitle.toLowerCase()): CatalogTrack => ({
  trackId, title, artistId, artistTitle, genre, year: 2001
});

const library: CatalogTrack[] = [
  track('101', 'Midnight Highway', 'Night Owls', 'Synthwave'),
  track('102', 'Neon Drive', 'Night Owls', 'Synthwave'),
  track('103', 'Slow Heart', 'Velvet Ruin', 'Ballad'),
  track('104', 'Tears in the Rain', 'Velvet Ruin', 'Ballad'),
  track('105', 'Rain Dance', 'Storm Choir', 'Pop'),
  track('106', 'Highway Blues', 'Dust Road', 'Blues'),
  track('107', 'Ballroom Stomp', 'Dust Road', 'Swing')
];

describe('prompted playlist: id validation', () => {
  it('keeps only ids that are in the library and drops invented ones', () => {
    const valid = new Set(library.map(t => t.trackId));
    const reply = JSON.stringify({ name: 'Night drive', trackIds: ['101', '999', '102', 'made-up', 103, '102'] });
    const out = parsePlaylistReply(reply, valid, 'fallback');
    expect(out.name).toBe('Night drive');
    expect(out.trackIds).toEqual(['101', '102', '103']);
  });

  it('reads JSON wrapped in a code fence or with words around it', () => {
    const valid = new Set(['1', '2']);
    const out = parsePlaylistReply('Here you go:\n```json\n{"name": "Calm", "trackIds": ["2", "1"]}\n```', valid, 'fallback');
    expect(out).toEqual({ name: 'Calm', trackIds: ['2', '1'] });
  });

  it('returns nothing usable from a broken reply, with the fallback name', () => {
    expect(parsePlaylistReply('sorry, I cannot', new Set(['1']), 'My words')).toEqual({ name: 'My words', trackIds: [] });
    expect(parsePlaylistReply('{"trackIds": ["x", "y"]}', new Set(['1']), 'My words')).toEqual({ name: 'My words', trackIds: [] });
  });

  it('caps the playlist length', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `t${i}`);
    const out = parsePlaylistReply(JSON.stringify({ trackIds: ids }), new Set(ids), 'x');
    expect(out.trackIds.length).toBe(PLAYLIST_MAX);
  });
});

describe('prompted playlist: candidates', () => {
  it('samples across artists, so one band cannot take the whole list', () => {
    const big = [
      ...Array.from({ length: 50 }, (_, i) => track(`big-${i}`, `B${i}`, 'Huge Band', 'Rock')),
      ...Array.from({ length: 5 }, (_, i) => track(`s-${i}`, `S${i}`, `Small ${i}`, 'Jazz'))
    ];
    const sample = sampleCandidates(big, 10, () => 0.5);
    expect(sample).toHaveLength(10);
    const artists = new Set(sample.map(t => t.artistId));
    expect(artists.size).toBe(6);
  });

  it('writes one id|title|artist|genre|year line per track', () => {
    const lines = candidateLines([track('7', 'Pipe | Title', 'Band', 'Rock')]).split('\n');
    expect(lines).toEqual(['7|Pipe Title|Band|Rock|2001']);
  });
});

describe('prompted playlist: keyword fallback', () => {
  it('picks words from the request and matches them to genre, title and artist', () => {
    expect(promptWords('late-night drive, no ballads')).toEqual(['late', 'night', 'drive']);
    const out = keywordPlaylist('highway blues', library);
    expect(out.trackIds[0]).toBe('106');
    expect(out.trackIds).toContain('101');
    expect(out.trackIds).not.toContain('103');
  });

  it('leaves out tracks that match what the person ruled out', () => {
    expect(excludedWords('late-night drive, no ballads')).toEqual(['ballads']);
    const out = keywordPlaylist('late-night drive, no ballads', [...library, track('108', 'Ballad of Drive', 'Other', 'Pop')]);
    expect(out.trackIds).toContain('101');
    expect(out.trackIds).not.toContain('108');
    expect(out.trackIds).not.toContain('103');
  });

  it('gives an empty list when no word matches, and names the playlist from the request', () => {
    const out = keywordPlaylist('polka for goats', library);
    expect(out.trackIds).toEqual([]);
    expect(out.name).toBe('polka for goats');
  });

  it('uses the request as the name, trimmed', () => {
    expect(keywordPlaylist('  rain   songs ', library).name).toBe('rain songs');
  });
});
