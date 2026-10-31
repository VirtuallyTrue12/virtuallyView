import { describe, test, expect, vi, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';

const { sendPlain, sonarr, subtitles } = vi.hoisted(() => ({
  sendPlain: vi.fn(),
  sonarr: { getEpisodes: vi.fn(), getEpisodeFile: vi.fn() },
  subtitles: new Map<string, string>()
}));

vi.mock('../../apps/server/src/services/ollama-provider.js', () => ({
  OllamaProvider: class {
    sendPlain(messages: unknown) { return sendPlain(messages); }
  }
}));
vi.mock('../../apps/server/src/services/registry.js', () => ({ getAdapter: () => sonarr }));
vi.mock('../../apps/server/src/routes/stream.js', () => ({ episodeAllowed: async () => true }));
vi.mock('../../apps/server/src/services/media-roots.js', () => ({ isAllowedMediaFile: () => true, getMediaRoots: () => [] }));
vi.mock('../../apps/server/src/services/subtitle-text.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../apps/server/src/services/subtitle-text.js')>()),
  // Each episode file maps to a fixed VTT, so the test controls exactly what the assistant would read.
  englishSubtitleVtt: async (path: string) => subtitles.get(path) ?? null
}));

import recapRoutes from '../../apps/server/src/routes/recap.js';

const AI_OFF = 'Recaps need the assistant (switched off right now) and subtitles for the earlier episodes.';
const NO_SUBS = 'Recaps need subtitles for the earlier episodes. None were found for this show yet.';

const episode = (n: number, hasFile = true) => ({ id: `episode-${n}`, seriesId: 'sonarr-1', seasonNumber: 1, episodeNumber: n, title: `Ep ${n}`, hasFile });

// Cues at 1s, 20s, 310s and 500s. A recap at 400s (cut to 300s) may use only the first two.
const CURRENT_VTT = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello there.

00:00:20.000 --> 00:00:22.000
The door opens.

00:05:10.000 --> 00:05:12.000
Nobody knows yet.

00:08:20.000 --> 00:08:22.000
Late reveal.
`;
const EARLIER_VTT = `WEBVTT

00:00:05.000 --> 00:00:07.000
Last week we left Mara at the station.
`;

const app = Fastify();
await app.register(recapRoutes);
afterAll(async () => { await app.close(); });

beforeEach(() => {
  sendPlain.mockReset();
  sonarr.getEpisodes.mockReset();
  sonarr.getEpisodeFile.mockReset();
  subtitles.clear();
});

/** Season 1 with episodes 1 and 2 (both with files) and 3 (no file yet), plus the files' subtitles. */
function showWith(prefix: string) {
  sonarr.getEpisodes.mockResolvedValue([episode(1), episode(2), episode(3, false)]);
  sonarr.getEpisodeFile.mockImplementation(async (id: string) => ({ path: `/media/${prefix}/${id}.mkv` }));
  subtitles.set(`/media/${prefix}/episode-1.mkv`, EARLIER_VTT);
  subtitles.set(`/media/${prefix}/episode-2.mkv`, CURRENT_VTT);
}

describe('recap route', () => {
  test('returns the friendly message when the assistant throws', async () => {
    showWith('ai-off');
    sendPlain.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await app.inject({ method: 'GET', url: '/api/recap/episode/episode-2?series=sonarr-1&at=400' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false, message: AI_OFF });
  });

  test('gives the subtitle message, and does not ask the assistant, when there is no dialogue', async () => {
    sonarr.getEpisodes.mockResolvedValue([episode(1, false), episode(2)]);
    sonarr.getEpisodeFile.mockResolvedValue({ path: '/media/no-subs/episode-2.mkv' });
    const res = await app.inject({ method: 'GET', url: '/api/recap/episode/episode-2?series=sonarr-1&at=400' });
    expect(res.json()).toEqual({ available: false, message: NO_SUBS });
    expect(sendPlain).not.toHaveBeenCalled();
  });

  test('sends only the dialogue before the cutoff, and reuses the answer for the same five-minute step', async () => {
    showWith('cache');
    sendPlain.mockResolvedValue('Here you go:\n- Mara reaches the station.\n- The door opens.');

    const first = await app.inject({ method: 'GET', url: '/api/recap/episode/episode-2?series=sonarr-1&at=400' });
    expect(first.json()).toEqual({ available: true, bullets: ['Mara reaches the station.', 'The door opens.'] });

    const sent = JSON.stringify(sendPlain.mock.calls[0][0]);
    expect(sent).toContain('The door opens.');
    expect(sent).toContain('Last week we left Mara at the station.');
    expect(sent).not.toContain('Nobody knows yet.');
    expect(sent).not.toContain('Late reveal.');

    // 550s is in the same five-minute step (cut at 300s), so no second request to the assistant.
    const second = await app.inject({ method: 'GET', url: '/api/recap/episode/episode-2?series=sonarr-1&at=550' });
    expect(second.json()).toEqual(first.json());
    expect(sendPlain).toHaveBeenCalledTimes(1);
  });

  test('refuses an episode that is not in the show it names', async () => {
    showWith('wrong-show');
    const res = await app.inject({ method: 'GET', url: '/api/recap/episode/episode-99?series=sonarr-1&at=400' });
    expect(res.statusCode).toBe(404);
  });
});
