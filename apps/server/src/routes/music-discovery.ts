import type { FastifyInstance } from 'fastify';
import type { LidarrAdapter, RadarrAdapter, SonarrAdapter } from '@virtuallyview/integrations';
import { all as dbAll, get as dbGet, run as dbRun } from '../db/app-db.js';
import { currentUserId } from '../services/user-context.js';
import { getAdapter } from '../services/registry.js';
import { OllamaProvider } from '../services/ollama-provider.js';
import { libraryCatalog } from '../services/music-catalog.js';
import { buildWeeklyMixes, isoWeekKey, type CatalogTrack, type PlayRecord } from '../services/music-mixes.js';
import { candidateLines, keywordPlaylist, MAX_CANDIDATES, parsePlaylistReply, playlistMessages, sampleCandidates } from '../services/prompted-playlist.js';
import { yearInReview, type ReviewEpisode, type ReviewFilm, type ReviewPlay } from '../services/year-review.js';
import { CreditsUnavailable, fetchReleaseCredits } from '../services/musicbrainz-credits.js';
import { filterByRating } from '../services/parental.js';
import { parseTranslation } from '../services/lyrics-translate.js';

export const ASSISTANT_OFF_SENTENCE = 'Prompted playlists need the assistant, which is switched off right now.';
export const TRANSLATE_OFF_SENTENCE = 'Lyrics translation needs the assistant, which is switched off right now.';

const LANGUAGES: Record<string, string> = {
  english: 'English',
  hindi: 'Hindi (in Devanagari script)',
  spanish: 'Spanish',
  french: 'French',
  japanese: 'Japanese',
  korean: 'Korean',
  romanised: 'Romanised pronunciation of the original language, written with Latin letters'
};

/** The assistant, or null when it is switched off or cannot answer. */
async function askAssistant(messages: Array<{ role: 'system' | 'user'; content: string }>, numCtx?: number): Promise<string | null> {
  const ollama = new OllamaProvider();
  try {
    if (!(await ollama.healthCheck())) return null;
    return await ollama.sendPlain(messages, numCtx);
  } catch {
    return null;
  }
}

export default async function musicDiscoveryRoutes(server: FastifyInstance) {
  // Records a song that has counted as played: 30 seconds in, or played to the end.
  server.post<{ Body: { trackId?: string; title?: string; artistId?: string; artist?: string; albumId?: string; genre?: string; durationMs?: number } }>(
    '/api/music/plays',
    async (request, reply) => {
      const body = request.body ?? {};
      const trackId = typeof body.trackId === 'string' ? body.trackId.trim().slice(0, 60) : '';
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : '';
      if (!trackId || !title) return reply.code(400).send({ error: 'bad_request', message: 'A track id and title are required.' });
      const clip = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
      dbRun(
        `INSERT INTO music_plays (user_id, track_id, artist_id, album_id, title, artist, genre, duration_ms, played_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        currentUserId(), trackId, clip(body.artistId, 60), clip(body.albumId, 60), title,
        clip(body.artist, 300) ?? '', clip(body.genre, 80),
        Math.max(0, Math.min(Number(body.durationMs) || 0, 24 * 60 * 60 * 1000)),
        new Date().toISOString()
      );
      return { ok: true };
    }
  );

  // Up to three mixes, the same for the whole ISO week.
  server.get('/api/music/mixes', async (_request, reply) => {
    const now = new Date();
    let catalog: CatalogTrack[];
    try {
      catalog = await libraryCatalog();
    } catch {
      return reply.code(200).send({ week: isoWeekKey(now), mixes: [], message: 'Your music service is not connected, so mixes cannot be made yet.' });
    }
    const plays = dbAll<PlayRecord>('SELECT track_id AS trackId, played_at AS playedAt FROM music_plays WHERE user_id = ?', currentUserId());
    const mixes = buildWeeklyMixes({ userId: currentUserId(), now, plays, catalog });
    return { week: isoWeekKey(now), mixes };
  });

  // A playlist from a description. Only library tracks can appear in it.
  server.post<{ Body: { prompt?: string } }>('/api/music/playlist-prompt', async (request, reply) => {
    const prompt = typeof request.body?.prompt === 'string' ? request.body.prompt.trim().replace(/\s+/g, ' ') : '';
    if (prompt.length < 3 || prompt.length > 200) {
      return reply.code(400).send({ error: 'bad_request', message: 'Describe the playlist in 3 to 200 characters.' });
    }
    let catalog: CatalogTrack[];
    try {
      catalog = await libraryCatalog();
    } catch {
      return reply.code(200).send({ source: 'none', assistant: 'on', name: prompt, tracks: [], message: 'Your music service is not connected, so there is nothing to build from yet.' });
    }
    if (!catalog.length) {
      return reply.code(200).send({ source: 'none', assistant: 'on', name: prompt, tracks: [], message: 'There is no music in the library yet.' });
    }
    const byId = new Map(catalog.map(t => [t.trackId, t]));
    const toTracks = (ids: string[]) => ids.map(id => byId.get(id)).filter((t): t is CatalogTrack => !!t);

    const sample = sampleCandidates(catalog, MAX_CANDIDATES, Math.random);
    const answer = await askAssistant(playlistMessages(prompt, candidateLines(sample)), 8192);
    if (answer === null) {
      const fallback = keywordPlaylist(prompt, catalog);
      return { source: 'keywords', assistant: 'off', name: fallback.name, message: ASSISTANT_OFF_SENTENCE, tracks: toTracks(fallback.trackIds) };
    }
    const picked = parsePlaylistReply(answer, new Set(sample.map(t => t.trackId)), prompt.slice(0, 60));
    if (picked.trackIds.length >= 1) {
      return { source: 'assistant', assistant: 'on', name: picked.name, tracks: toTracks(picked.trackIds) };
    }
    const fallback = keywordPlaylist(prompt, catalog);
    return { source: 'keywords', assistant: 'on', name: fallback.name, message: 'The assistant did not find a good match, so these are keyword matches.', tracks: toTracks(fallback.trackIds) };
  });

  // One scrolling year: minutes, top artists, songs, genre, films and shows, and the first play.
  server.get<{ Params: { year: string } }>('/api/review/:year', async (request, reply) => {
    const year = Number(request.params.year);
    if (!/^\d{4}$/.test(request.params.year) || year < 2000 || year > 2100) {
      return reply.code(400).send({ error: 'bad_request', message: 'Pick a year from 2000 to 2100.' });
    }
    const from = `${year}-01-01T00:00:00.000Z`;
    const to = `${year + 1}-01-01T00:00:00.000Z`;
    const uid = currentUserId();
    const plays = dbAll<ReviewPlay>(
      `SELECT track_id AS trackId, title, artist, genre, duration_ms AS durationMs, played_at AS playedAt
       FROM music_plays WHERE user_id = ? AND played_at >= ? AND played_at < ?`,
      uid, from, to
    );

    // Titles come from the video services. A title they no longer have is left out.
    const [films, series] = await Promise.all([
      (async () => {
        try { return filterByRating(await getAdapter<RadarrAdapter>('radarr').getItems()); } catch { return []; }
      })(),
      (async () => {
        try { return filterByRating(await getAdapter<SonarrAdapter>('sonarr').getItems()); } catch { return []; }
      })()
    ]);
    const filmTitles = new Map(films.map(f => [f.id, f]));
    const seriesTitles = new Map(series.map(s => [s.id, s]));

    const filmRows = [
      ...dbAll<{ mediaId: string; finishedAt: string }>(
        `SELECT media_id AS mediaId, finished_at AS finishedAt FROM watch_finished
         WHERE user_id = ? AND media_type = 'movie' AND finished_at >= ? AND finished_at < ?`,
        uid, from, to
      ),
      ...dbAll<{ mediaId: string; finishedAt: string }>(
        `SELECT media_id AS mediaId, updated_at AS finishedAt FROM user_flags
         WHERE user_id = ? AND media_type = 'movie' AND watched = 1 AND updated_at >= ? AND updated_at < ?`,
        uid, from, to
      )
    ];
    const seenFilm = new Set<string>();
    const filmList: ReviewFilm[] = [];
    for (const row of filmRows) {
      const film = filmTitles.get(row.mediaId);
      if (!film || seenFilm.has(row.mediaId)) continue;
      seenFilm.add(row.mediaId);
      filmList.push({ id: row.mediaId, title: film.title, finishedAt: row.finishedAt, ...(typeof film.rating === 'number' ? { rating: film.rating } : {}) });
    }

    const episodes = dbAll<{ seriesId: string; finishedAt: string }>(
      `SELECT series_id AS seriesId, finished_at AS finishedAt FROM watch_finished
       WHERE user_id = ? AND media_type = 'episode' AND series_id IS NOT NULL AND finished_at >= ? AND finished_at < ?`,
      uid, from, to
    );
    const episodeList: ReviewEpisode[] = [];
    for (const row of episodes) {
      const show = seriesTitles.get(row.seriesId);
      if (show) episodeList.push({ seriesId: row.seriesId, seriesTitle: show.title, finishedAt: row.finishedAt });
    }

    return { review: yearInReview({ year, plays, films: filmList, episodes: episodeList }) };
  });

  // Writers, producers and performers for an album, from MusicBrainz via the release Lidarr follows.
  server.get<{ Params: { id: string } }>('/api/albums/:id/credits', async (request, reply) => {
    const numeric = request.params.id.replace(/^album-/, '');
    if (!/^\d+$/.test(numeric)) return reply.code(400).send({ error: 'bad_request', message: 'Invalid album id.' });
    let releaseId: string | undefined;
    try {
      const album = await getAdapter<LidarrAdapter>('lidarr').getAlbum(numeric);
      releaseId = album?.foreignReleaseId;
    } catch {
      return { status: 'unavailable', message: 'The music service is not available right now.' };
    }
    if (!releaseId || !/^[0-9a-f-]{36}$/i.test(releaseId)) return { status: 'none' };
    try {
      const credits = await fetchReleaseCredits(releaseId);
      if (!credits) return { status: 'none' };
      return { status: 'found', album: { writers: credits.writers, producers: credits.producers, performers: credits.performers }, tracks: credits.tracks };
    } catch (error) {
      if (error instanceof CreditsUnavailable) return { status: 'unavailable', message: 'MusicBrainz could not be reached right now. Try again later.' };
      throw error;
    }
  });

  // Lyrics translation: same number of lines, same order, blank lines kept. Cached per track and language.
  server.post<{ Body: { artist?: string; title?: string; album?: string; language?: string; lines?: unknown } }>('/api/lyrics/translate', async (request, reply) => {
    const body = request.body ?? {};
    const language = typeof body.language === 'string' ? body.language : '';
    const languageName = LANGUAGES[language];
    if (!languageName) return reply.code(400).send({ error: 'bad_request', message: 'Pick one of the languages on the list.' });
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length || lines.length > 300 || lines.some(l => typeof l !== 'string' || l.length > 300)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Send the lyric lines, up to 300.' });
    }
    const lyricLines = lines as string[];
    const artist = typeof body.artist === 'string' ? body.artist.trim().slice(0, 200) : '';
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const album = typeof body.album === 'string' ? body.album.trim().slice(0, 200) : '';
    const cacheKey = `${artist}|${title}|${album}|${language}`.toLowerCase();

    const cached = dbGet<{ lines: string }>('SELECT lines FROM lyrics_translations WHERE cache_key = ?', cacheKey);
    if (cached) {
      const saved = JSON.parse(cached.lines) as string[];
      if (saved.length === lyricLines.length) return { language, lines: saved, cached: true };
    }

    const sung = lyricLines.map((l, i) => ({ l: l.trim(), i })).filter(x => x.l);
    const answer = await askAssistant([
      { role: 'system', content: `You translate song lyrics into ${languageName}. Keep the same number of lines, in the same order. Reply with JSON only: {"lines": ["...", "..."]}.` },
      { role: 'user', content: JSON.stringify(sung.map(x => x.l)) }
    ], 4096);
    if (answer === null) return reply.code(503).send({ error: 'assistant_off', message: TRANSLATE_OFF_SENTENCE });

    const translated = parseTranslation(answer, sung.length);
    if (!translated) return reply.code(502).send({ error: 'bad_translation', message: 'The translation came out in the wrong shape. Try again.' });
    const full = lyricLines.map(() => '');
    sung.forEach((x, n) => { full[x.i] = translated[n]!; });
    dbRun(
      'INSERT INTO lyrics_translations (cache_key, lines, created_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET lines = excluded.lines, created_at = excluded.created_at',
      cacheKey, JSON.stringify(full), new Date().toISOString()
    );
    return { language, lines: full, cached: false };
  });
}
