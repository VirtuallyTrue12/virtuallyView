import type { FastifyInstance } from 'fastify';
import { EVENTS, deliver, listNotifications, markRead } from '../services/notifications.js';
import type { NotificationChannel } from '../services/server-settings.js';

export default async function notificationRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { limit?: string } }>('/api/notifications', async request => ({
    ...listNotifications(Math.min(100, Math.max(1, Number(request.query.limit) || 30))),
    events: EVENTS
  }));

  server.post<{ Body: { ids?: number[]; all?: boolean } }>('/api/notifications/read', async request => {
    markRead(request.body?.all ? 'all' : (request.body?.ids ?? []).filter(n => Number.isInteger(n)));
    return listNotifications(30);
  });

  // Send a test message through a channel exactly as configured in the form (admin only via the global guard).
  server.post<{ Body: { channel?: NotificationChannel } }>('/api/notifications/test', async (request, reply) => {
    const channel = request.body?.channel;
    if (!channel?.kind) return reply.code(400).send({ message: 'Choose a channel to test.' });
    try {
      await deliver(channel, { type: 'backup', title: 'virtuallyView test', body: 'If you can read this, the channel works.' });
      return { ok: true };
    } catch (error) {
      return reply.code(502).send({ ok: false, message: error instanceof Error ? error.message : 'The message could not be sent.' });
    }
  });
}
