import type { FastifyInstance } from 'fastify';
import { DEFAULT_VOICE, speech, TTS_VOICES, ttsAvailable } from '../services/tts.js';

/** Spoken lines for DJ mode and radio announcements (see services/tts). */
export default async function ttsRoutes(server: FastifyInstance) {
  server.get('/api/tts/voices', async () => ({ available: await ttsAvailable(), voices: TTS_VOICES, default: DEFAULT_VOICE }));

  server.get<{ Querystring: { text?: string; voice?: string; speed?: string } }>('/api/tts', async (request, reply) => {
    const text = (request.query.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) return reply.code(400).send({ message: 'Nothing to say.' });
    const audio = await speech(text, request.query.voice ?? DEFAULT_VOICE, Number(request.query.speed ?? 1));
    if (!audio) return reply.code(503).send({ message: 'The voice server is not running.' });
    return reply.header('Content-Type', 'audio/wav').header('Cache-Control', 'private, max-age=86400').send(audio);
  });
}
