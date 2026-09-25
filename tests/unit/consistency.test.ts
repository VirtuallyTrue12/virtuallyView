import { describe, test, expect } from 'vitest';
import { matchLibraryTitle, mediaTypeOfCategory, normalizeStatus } from '../../apps/server/src/services/real-downloads.js';
import { completenessOf, isPartial, isStalled, leadRow, partlyMessage } from '../../apps/server/src/services/queue-state.js';
import { annotateWithRequests } from '../../apps/server/src/routes/search.js';

describe('Downloads and Requests describe a download the same way', () => {
  test('a stalled download is "stalled" on both, not "failed" on one and "downloading" on the other', () => {
    expect(normalizeStatus('radarr', 'warning', 0, 'The download is stalled with no connections')).toBe('stalled');
    expect(isStalled('warning', 'The download is stalled with no connections')).toBe(true);
    // A real failure, or a stall on something already finished, is still what it was.
    expect(normalizeStatus('radarr', 'warning', 0, 'Sample file')).toBe('failed');
    expect(normalizeStatus('lidarr', 'warning', 100, 'stalled')).toBe('failed');
    expect(normalizeStatus('qbittorrent', 'stalledDL', 40)).toBe('downloading'); // slow, not dead
  });

  test('the client\'s label says what a torrent is', () => {
    expect(mediaTypeOfCategory('radarr')).toBe('movie');
    expect(mediaTypeOfCategory('Sonarr')).toBe('series');
    expect(mediaTypeOfCategory('lidarr')).toBe('artist');
    expect(mediaTypeOfCategory('vv-concerts')).toBe('artist');
    expect(mediaTypeOfCategory('')).toBeUndefined();
  });
});

describe('matching a release name to the title in the library', () => {
  const library = [
    { title: 'How I Met Your Mother', type: 'series' }, { title: 'How I Met Your Mother', type: 'movie' },
    { title: 'Spider-Man: Brand New Day', type: 'movie', year: 2026 }, { title: 'Pink Floyd', type: 'artist' },
    { title: 'It', type: 'movie' }, { title: 'Queen', type: 'artist' }
  ];
  test('a season pack belongs to its series, a film release to its film, an album to its artist', () => {
    expect(matchLibraryTitle('How I Met Your Mother S07 S07 (1080p Web x265 HEVC AAC)', library, 'series')?.type).toBe('series');
    expect(matchLibraryTitle('Spider-Man- Brand New Day 2026.1080p.HQ Pre.Multi.AAC 2.0.x264', library, 'movie')?.title).toBe('Spider-Man: Brand New Day');
    expect(matchLibraryTitle('Pink Floyd - The Wall (1979)', library, 'artist')?.title).toBe('Pink Floyd');
  });
  test('short titles must match exactly, and the wrong kind never matches', () => {
    expect(matchLibraryTitle('It Follows 2014 1080p', library)).toBeUndefined();
    expect(matchLibraryTitle('Queen Live at Wembley', library, 'movie')).toBeUndefined();
    expect(matchLibraryTitle('Something Else Entirely', library)).toBeUndefined();
  });
});

describe('how complete a title is', () => {
  test('counts real seasons for a series (not specials) and tracks for an artist', () => {
    const series = completenessOf({ type: 'series', seasons: [{ number: 0, episodes: 3, availableEpisodes: 0 }, { number: 1, episodes: 22, availableEpisodes: 22 }, { number: 2, episodes: 22, availableEpisodes: 10 }] });
    expect(series).toEqual({ have: 32, total: 44, unit: 'episodes' });
    expect(isPartial(series)).toBe(true);
    expect(partlyMessage(series!)).toBe('Partly available: 32 of 44 episodes.');
    expect(completenessOf({ type: 'artist', trackFileCount: 39, totalTrackCount: 107 })).toEqual({ have: 39, total: 107, unit: 'tracks' });
    expect(isPartial(completenessOf({ type: 'artist', trackFileCount: 10, totalTrackCount: 10 }))).toBe(false);
    expect(completenessOf({ type: 'movie' })).toBeNull();
  });
  test('one queue row speaks for many: the one that is moving', () => {
    expect(leadRow([{ status: 'queued' }, { status: 'downloading' }, { status: 'warning' }])?.status).toBe('downloading');
    expect(leadRow([])).toBeUndefined();
  });
});

describe('search shows what is already requested', () => {
  const result = {
    movies: [{ provider: 'tmdb', providerId: '1', title: 'Dune', year: 2021, type: 'movie' }, { provider: 'tmdb', providerId: '2', title: 'Dune', year: 1984, type: 'movie' }],
    series: [], artists: [{ provider: 'musicbrainz', providerId: 'mb-1', title: 'Pink Floyd', type: 'artist' }]
  };
  test('marks a result by its identity or by title and year, ignores cancelled requests', () => {
    const out = annotateWithRequests(result, [
      { id: 'request-1', status: 'downloading', title: 'Dune', year: 2021, mediaType: 'movie', metadataProvider: 'tmdb', selectedProviderId: '1' },
      { id: 'request-2', status: 'searching', title: 'Pink Floyd', mediaType: 'artist' },
      { id: 'request-3', status: 'cancelled', title: 'Dune', year: 1984, mediaType: 'movie', metadataProvider: 'tmdb', selectedProviderId: '2' }
    ]);
    expect(out.movies[0]).toMatchObject({ requestId: 'request-1', requestStatus: 'downloading' });
    expect(out.movies[1]).not.toHaveProperty('requestStatus');
    expect(out.artists[0]).toMatchObject({ requestId: 'request-2', requestStatus: 'searching' });
  });
});

import { queueProblem } from '../../packages/integrations/src/request-identity.js';

describe('the media services tell us why a download is stuck', () => {
  test('a stalled download carries its reason; a healthy one carries nothing', () => {
    expect(queueProblem({ trackedDownloadStatus: 'warning', trackedDownloadState: 'downloading', errorMessage: 'The download is stalled with no connections' }))
      .toEqual({ status: 'warning', message: 'The download is stalled with no connections' });
    // Radarr really reports it with trackedDownloadStatus "ok": the reason text is what tells.
    expect(queueProblem({ status: 'warning', trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading', errorMessage: 'The download is stalled with no connections' }).message).toMatch(/stalled/);
    expect(queueProblem({ trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading' })).toEqual({});
    expect(queueProblem({ trackedDownloadStatus: 'warning', trackedDownloadState: 'importBlocked', statusMessages: [{ messages: ['Not an upgrade'] }] }).status).toBe('warning');
  });
});
