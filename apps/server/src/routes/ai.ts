import type { FastifyInstance } from 'fastify';
import { totalmem, freemem, cpus } from 'node:os';
import { Agent } from '../services/ai.js';
import { OllamaProvider } from '../services/ollama-provider.js';
import { getPermissionLevel, setPermissionLevel, listPermissionLevels, type PermissionLevel } from '../services/ai-permissions.js';
import { getAiHistory } from '../services/ai-history.js';
import { searchCatalog, fitFor } from '../services/model-catalog.js';

interface PullJob {
  status: 'running' | 'done' | 'error';
  message?: string;
  percent?: number;
  updatedAt: number;
}

const pullJobs = new Map<string, PullJob>();

async function pullInBackground(provider: OllamaProvider, name: string) {
  pullJobs.set(name, { status: 'running', updatedAt: Date.now() });
  try {
    const res = await fetch(`${provider.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true })
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      pullJobs.set(name, { status: 'error', message: `Ollama pull failed (${res.status}) ${body}`.trim(), updatedAt: Date.now() });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
          if (evt.error) {
            pullJobs.set(name, { status: 'error', message: evt.error, updatedAt: Date.now() });
            continue;
          }
          const percent = evt.total && evt.completed ? Math.round((evt.completed / evt.total) * 100) : undefined;
          pullJobs.set(name, { status: 'running', message: evt.status, percent, updatedAt: Date.now() });
        } catch {
          // ignore malformed line, keep waiting for the next one
        }
      }
    }
    const finalJob = pullJobs.get(name);
    if (finalJob?.status !== 'error') {
      pullJobs.set(name, { status: 'done', updatedAt: Date.now() });
    }
  } catch (err) {
    pullJobs.set(name, { status: 'error', message: (err as Error).message, updatedAt: Date.now() });
  }
}

async function ensureDefaultModel(provider: OllamaProvider): Promise<void> {
  if (!(await provider.healthCheck())) return;
  const models = await provider.listModels();
  if (!models.some(model => model.id === provider.modelName)) {
    if (pullJobs.get(provider.modelName)?.status !== 'running') {
      void pullInBackground(provider, provider.modelName);
    }
  }
}

export default async function aiRoutes(server: FastifyInstance) {
  const agent = new Agent();
  const provider = agent.providerInfo instanceof OllamaProvider
    ? agent.providerInfo
    : new OllamaProvider();
  void ensureDefaultModel(provider);
  setTimeout(() => void ensureDefaultModel(provider), 10000);

  server.get('/api/ai/health', async () => {
    const healthy = await agent.providerInfo.healthCheck();
    const model = healthy ? await agent.providerInfo.getModel() : null;
    return {
      configured: healthy,
      provider: agent.providerInfo.id,
      model: model?.id ?? null,
      healthy
    };
  });

  server.get('/api/ai/models', async () => {
    try {
      const models = await provider.listModels();
      return { models };
    } catch {
      return { models: [] };
    }
  });

  server.post<{
    Body: { model?: string };
  }>('/api/ai/pull', async (request, reply) => {
    const { model } = request.body ?? {};
    if (!model?.trim()) {
      return reply.code(400).send({ message: 'Model name is required.' });
    }
    const name = model.trim();

    if (!(await provider.healthCheck())) {
      return reply.code(503).send({ message: 'Ollama is offline. Start it, then pull models here.' });
    }

    if (pullJobs.get(name)?.status === 'running') {
      return reply.code(409).send({ message: `Already pulling "${name}".` });
    }

    pullInBackground(provider, name);
    return { success: true, model: name, status: 'running' };
  });

  server.get<{
    Params: { model: string };
  }>('/api/ai/pull/:model/status', async request => {
    const job = pullJobs.get(request.params.model);
    return { model: request.params.model, status: job?.status ?? 'unknown', message: job?.message, percent: job?.percent };
  });

  server.get<{ Querystring: { q?: string } }>('/api/ai/models/catalog', async request => {
    // Fit is judged against total RAM, not free: free fluctuates with whatever
    // else happens to be running at the moment of the request, which would
    // make the same model flip between "fits" and "too big" from one check to
    // the next. Total is the stable number a person actually sized their machine to.
    const totalGB = totalmem() / 1024 ** 3;
    const models = searchCatalog(request.query.q ?? '').map(m => ({ ...m, fit: fitFor(m.ramGB, totalGB) }));
    return {
      models,
      system: { totalMemGB: Math.round(totalGB * 10) / 10, freeMemGB: Math.round((freemem() / 1024 ** 3) * 10) / 10, cpuCount: cpus().length }
    };
  });

  server.get('/api/ai/pull/active', async () => {
    const jobs = [...pullJobs.entries()]
      .filter(([, job]) => job.status === 'running')
      .map(([model, job]) => ({ model, status: job.status, message: job.message, percent: job.percent }));
    return { jobs };
  });

  server.get('/api/ai/tools', async () => ({ tools: agent.listTools() }));

  server.get('/api/ai/permissions', async () => ({
    level: getPermissionLevel(),
    levels: listPermissionLevels()
  }));

  server.post<{ Body: { level: PermissionLevel } }>('/api/ai/permissions', async (request, reply) => {
    try {
      setPermissionLevel(request.body?.level);
      return { level: getPermissionLevel() };
    } catch (err) {
      return reply.code(400).send({ message: (err as Error).message });
    }
  });

  server.get('/api/ai/history', async () => ({ history: getAiHistory() }));

  server.post<{
    Body: {
      message: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
      confirm?: { tool: string; arguments: Record<string, unknown> };
    };
  }>('/api/ai/chat', async (request, reply) => {
    const { message, history, confirm } = request.body ?? {};
    if (!message?.trim() && !confirm) {
      return reply.code(400).send({ message: 'Message is required.' });
    }
    try {
      return await agent.chat(message ?? '', { history: history ?? [], confirm: confirm ?? null });
    } catch (err) {
      return reply.code(500).send({ kind: 'error', message: (err as Error).message });
    }
  });

  // Same answer as /api/ai/chat, delivered progressively: the reply text is
  // already fully generated (this does not touch how the model itself runs,
  // which stays in strict JSON mode for reliable tool-calling on a small
  // model) but is sent to the client a few words at a time as newline-
  // delimited JSON, so a long answer appears while it arrives instead of
  // all at once. The final line always carries the complete reply.
  server.post<{
    Body: {
      message: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
      confirm?: { tool: string; arguments: Record<string, unknown> };
    };
  }>('/api/ai/chat/stream', async (request, reply) => {
    const { message, history, confirm } = request.body ?? {};
    if (!message?.trim() && !confirm) {
      return reply.code(400).send({ message: 'Message is required.' });
    }
    reply.raw.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    let result: Awaited<ReturnType<typeof agent.chat>>;
    try {
      result = await agent.chat(message ?? '', { history: history ?? [], confirm: confirm ?? null });
    } catch (err) {
      reply.raw.end(`${JSON.stringify({ done: true, reply: { kind: 'error', message: (err as Error).message } })}\n`);
      return;
    }
    const text = result.kind === 'message' || result.kind === 'tool-result' ? result.text : '';
    if (text) {
      const words = text.split(/(?<=\s)/); // keep trailing spaces attached, so words join back cleanly
      const delayMs = Math.max(8, Math.min(40, Math.round(600 / Math.max(1, words.length))));
      for (const word of words) {
        reply.raw.write(`${JSON.stringify({ delta: word })}\n`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    reply.raw.end(`${JSON.stringify({ done: true, reply: result })}\n`);
  });
}