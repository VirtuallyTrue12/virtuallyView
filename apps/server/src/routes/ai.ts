import type { FastifyInstance } from 'fastify';
import { Agent } from '../services/ai.js';
import { OllamaProvider } from '../services/ollama-provider.js';
import { getPermissionLevel, setPermissionLevel, listPermissionLevels, type PermissionLevel } from '../services/ai-permissions.js';
import { getAiHistory } from '../services/ai-history.js';

interface PullJob {
  status: 'running' | 'done' | 'error';
  message?: string;
}

const pullJobs = new Map<string, PullJob>();

async function pullInBackground(provider: OllamaProvider, name: string) {
  pullJobs.set(name, { status: 'running' });
  try {
    const res = await fetch(`${provider.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      pullJobs.set(name, { status: 'error', message: `Ollama pull failed (${res.status}) ${body}`.trim() });
    } else {
      pullJobs.set(name, { status: 'done' });
    }
  } catch (err) {
    pullJobs.set(name, { status: 'error', message: (err as Error).message });
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
    return { model: request.params.model, status: job?.status ?? 'unknown', message: job?.message };
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
}