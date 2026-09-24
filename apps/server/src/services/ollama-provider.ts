import type { AIMessage, AIProvider, AIResponse, ToolCall } from '@virtuallyview/ai';

const DEFAULT_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:0.5b';

interface OllamaChatResponse {
  message?: { content?: string };
  done?: boolean;
}

function extractJson(text: string): string {
  const stripped = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) return stripped.slice(start, end + 1);
  return stripped;
}

function flattenArgs(
  args: Record<string, unknown>,
  parent: Record<string, unknown>
): Record<string, unknown> {
  const known = Object.keys(args).length ? args : {};
  for (const [key, value] of Object.entries(parent)) {
    if (key === 'type' || key === 'tool' || key === 'arguments' || key === 'text' || key === 'message') continue;
    if (!(key in known)) known[key] = value;
  }
  return known;
}

export class OllamaProvider implements AIProvider {
  id = 'ollama';
  name = 'Ollama';

  constructor(
    public readonly baseUrl: string = process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE,
    private model: string = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL
  ) {}

  get modelName(): string {
    return this.model;
  }

  private async chat(messages: AIMessage[], format?: string): Promise<OllamaChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: format ?? 'json',
        options: { temperature: 0.2, num_ctx: 2048 }
      })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${body}`);
    }
    return res.json();
  }

  async sendMessage(messages: AIMessage[]): Promise<AIResponse> {
    const data = await this.chat(messages, 'json');
    const content = (data?.message?.content ?? '').trim();
    if (!content) return { content: '' };

    try {
      const parsed = JSON.parse(extractJson(content)) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        const args = (parsed.arguments as Record<string, unknown>) ?? {};
        if (parsed.type === 'tool_call' && typeof parsed.tool === 'string') {
          const toolCall: ToolCall = { name: parsed.tool, arguments: args };
          return { content: '', toolCalls: [toolCall] };
        }
        if (typeof parsed.type === 'string' && (parsed.arguments !== undefined || parsed.additionalProperties !== undefined) && parsed.type !== 'message') {
          const flattened = flattenArgs(args, parsed);
          const toolCall: ToolCall = { name: parsed.type, arguments: flattened };
          return { content: '', toolCalls: [toolCall] };
        }
        const text =
          typeof parsed.text === 'string'
            ? parsed.text
            : typeof parsed.message === 'string'
              ? parsed.message
              : '';
        if (text) return { content: text };
      }
    } catch {
      // fall through to raw text
    }
    return { content };
  }

  /** A plain-text answer: no JSON constraint, no tools. For talking things through. */
  async sendPlain(messages: AIMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, stream: false, options: { temperature: 0.4, num_ctx: 2048, num_predict: 300 } })
    });
    if (!res.ok) throw new Error(`Ollama request failed (${res.status}): ${await res.text()}`);
    return (((await res.json()) as OllamaChatResponse)?.message?.content ?? '').trim();
  }

  async *streamResponse(messages: AIMessage[], format: string = 'json'): AsyncIterable<{ content: string }> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, stream: true, format, options: { temperature: 0.2, num_ctx: 2048 } })
    });
    if (!res.ok || !res.body) throw new Error(`Ollama stream failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed);
          const content = chunk?.message?.content ?? '';
          if (content) yield { content };
        } catch {
          // skip partial lines
        }
      }
    }
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name?: string }[] };
    return (data.models ?? []).map(m => ({ id: m.name ?? '', name: m.name ?? '' }));
  }

  async getModel(): Promise<{ id: string; name: string } | null> {
    const models = await this.listModels();
    return models.find(m => m.id === this.model) ?? (models[0] ?? null);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`);
      return res.ok;
    } catch {
      return false;
    }
  }
}