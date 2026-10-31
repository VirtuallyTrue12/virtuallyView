import type { FastifyInstance } from 'fastify';
import type { SonarrAdapter } from '@virtuallyview/integrations';
import { getAdapter } from '../services/registry.js';
import { isAllowedMediaFile } from '../services/media-roots.js';
import { ratingAllowed } from '../services/parental.js';
import { OllamaProvider } from '../services/ollama-provider.js';
import { capText, englishSubtitleVtt, vttPlainText } from '../services/subtitle-text.js';
import {
  getCachedRecap, parseBullets, rememberRecap, recapCacheKey, recapCutoff, recapRequest, RECAP_SYSTEM_PROMPT, RECAP_TEXT_CAP
} from '../services/recap.js';
import { episodeAllowed } from './stream.js';

type RecapResult = { available: true; bullets: string[] } | { available: false; message: string };

const AI_OFF = 'Recaps need the assistant (switched off right now) and subtitles for the earlier episodes.';
const NO_EPISODE_SUBS = 'Recaps need subtitles for the earlier episodes. None were found for this show yet.';
const NO_FILM_SUBS = 'Catch-up needs subtitles for this film. None were found yet.';
const EMPTY_REPLY = 'The recap came back empty. Try again in a moment.';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
type Episode = { id: string; seasonNumber: number; episodeNumber: number; hasFile: boolean };

/** Seconds into the item, from `?at=`. Anything unreadable counts as the start. */
function parseAt(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Dialogue from the earlier episodes of the season, then the current one up to `cutoff`, oldest first. */
async function episodeTranscript(list: Episode[], current: Episode, cutoff: number): Promise<string> {
  const sonarr = getAdapter<SonarrAdapter>('sonarr');
  const fileOf = async (id: string): Promise<string | null> => {
    try {
      const file = await sonarr.getEpisodeFile(id);
      return file?.path && isAllowedMediaFile(file.path) ? file.path : null;
    } catch {
      return null;
    }
  };
  // Newest first, so the cap keeps the lines closest to the cutoff.
  const newestFirst: string[] = [];
  let size = 0;
  const currentPath = await fileOf(current.id);
  if (currentPath) {
    const text = vttPlainText((await englishSubtitleVtt(currentPath)) ?? '', cutoff);
    if (text) { newestFirst.push(text); size += text.length; }
  }
  const earlier = list
    .filter(e => e.seasonNumber === current.seasonNumber && e.episodeNumber < current.episodeNumber && e.hasFile)
    .sort((a, b) => b.episodeNumber - a.episodeNumber);
  for (const episode of earlier) {
    if (size >= RECAP_TEXT_CAP) break;
    const path = await fileOf(episode.id);
    if (!path) continue;
    const text = vttPlainText((await englishSubtitleVtt(path)) ?? '');
    if (text) { newestFirst.push(text); size += text.length; }
  }
  return newestFirst.reverse().join('\n');
}

/** Dialogue from the film itself, up to `cutoff`. */
async function filmTranscript(filePath: string, cutoff: number): Promise<string> {
  const vtt = await englishSubtitleVtt(filePath);
  return vtt ? vttPlainText(vtt, cutoff) : '';
}

/**
 * One recap: cached per item and rounded cutoff, otherwise written by the local assistant from the
 * dialogue up to that cutoff. Every failure becomes a plain sentence, never an error page.
 */
async function recapFor(kind: 'episode' | 'movie', id: string, at: number, gather: (cutoff: number) => Promise<string>, noSubs: string): Promise<RecapResult> {
  const key = recapCacheKey(kind, id, at);
  const cached = getCachedRecap(key);
  if (cached) return { available: true, bullets: cached };

  const transcript = capText(await gather(recapCutoff(at)), RECAP_TEXT_CAP);
  if (!transcript.trim()) return { available: false, message: noSubs };

  let reply: string;
  try {
    reply = await new OllamaProvider().sendPlain([
      { role: 'system', content: RECAP_SYSTEM_PROMPT },
      // Small local models answer the last thing they read: the dialogue goes first, clearly fenced, and the
      // instruction after it, or the model "replies" to the dialogue instead of summarising it.
      { role: 'user', content: recapRequest(transcript) }
    ]);
  } catch {
    return { available: false, message: AI_OFF };
  }
  const bullets = parseBullets(reply);
  if (bullets.length === 0) return { available: false, message: EMPTY_REPLY };
  rememberRecap(key, bullets);
  return { available: true, bullets };
}

export default async function recapRoutes(server: FastifyInstance) {
  // "Previously on" for an episode. `series` says which show the episode belongs to; the episode must
  // be in that show's list, so the earlier episodes come from the same season of the same show.
  server.get<{ Params: { episodeId: string }; Querystring: { at?: string; series?: string } }>(
    '/api/recap/episode/:episodeId',
    async (request, reply) => {
      const { episodeId } = request.params;
      const seriesId = request.query.series ?? '';
      if (!ID_RE.test(episodeId) || !ID_RE.test(seriesId)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Pick an episode to catch up on.' });
      }
      if (!(await episodeAllowed(episodeId))) {
        return reply.code(403).send({ error: 'age_restricted', message: 'This is above the age limit set for your account.' });
      }
      let list: Episode[] = [];
      try {
        list = await getAdapter<SonarrAdapter>('sonarr').getEpisodes(seriesId);
      } catch {
        // Sonarr is off: no list means no earlier episodes, which the answer below explains.
      }
      const current = list.find(e => e.id === episodeId);
      if (!current) return reply.code(404).send({ error: 'not_found', message: 'That episode is not in this show.' });
      return recapFor('episode', episodeId, parseAt(request.query.at), cutoff => episodeTranscript(list, current, cutoff), NO_EPISODE_SUBS);
    }
  );

  // "Catch me up" for a film: only the dialogue before the current position.
  server.get<{ Params: { id: string }; Querystring: { at?: string } }>('/api/recap/movie/:id', async (request, reply) => {
    const { id } = request.params;
    if (!ID_RE.test(id)) return reply.code(400).send({ error: 'bad_request', message: 'Pick a film to catch up on.' });
    // Radarr off counts as a missing film.
    const movie = (await getAdapter('radarr').getItem(id).catch(() => null)) as { certification?: string; fileInfo?: { path?: string } } | null;
    if (!movie) return reply.code(404).send({ error: 'not_found', message: 'No such film.' });
    if (!ratingAllowed(movie.certification)) {
      return reply.code(403).send({ error: 'age_restricted', message: 'This is above the age limit set for your account.' });
    }
    const filePath = movie.fileInfo?.path;
    if (!filePath || !isAllowedMediaFile(filePath)) {
      return { available: false, message: NO_FILM_SUBS } satisfies RecapResult;
    }
    return recapFor('movie', id, parseAt(request.query.at), cutoff => filmTranscript(filePath, cutoff), NO_FILM_SUBS);
  });
}
