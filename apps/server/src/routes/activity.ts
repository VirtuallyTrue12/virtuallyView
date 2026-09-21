import type { FastifyInstance } from 'fastify';
import { getRequests } from '../services/requests.js';
import { getAiHistory } from '../services/ai-history.js';

interface ActivityEvent {
  id: string;
  timestamp: string;
  service: string;
  type: string;
  status: string;
  humanReadable: string;
  technicalDetails?: Record<string, unknown>;
}

const REQUEST_PHRASES: Record<string, string> = {
  pending: 'was requested',
  searching: 'is being searched for',
  downloading: 'is downloading',
  importing: 'is being imported',
  available: 'is now available',
  failed: 'could not be added',
  cancelled: 'was cancelled'
};

export default async function activityRoutes(server: FastifyInstance) {
  server.get('/api/activity', async () => {
    const events: ActivityEvent[] = [];

    for (const r of getRequests()) {
      events.push({
        id: `request-${r.id}`,
        timestamp: r.updatedAt,
        service: r.service,
        type: 'request',
        status: r.status,
        humanReadable: `${r.title} ${REQUEST_PHRASES[r.status] ?? r.status}`,
        technicalDetails: { requestId: r.id, message: r.message }
      });
    }

    for (const h of getAiHistory(30)) {
      events.push({
        id: `ai-${h.timestamp}-${h.tool}`,
        timestamp: h.timestamp,
        service: 'ai',
        type: 'ai_action',
        status: h.success ? 'ok' : 'error',
        humanReadable: h.success
          ? `Assistant ran ${h.tool.replace(/_/g, ' ')}`
          : `Assistant could not ${h.tool.replace(/_/g, ' ')}: ${h.message}`,
        technicalDetails: { tool: h.tool, arguments: h.arguments }
      });
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return events.slice(0, 100);
  });
}
