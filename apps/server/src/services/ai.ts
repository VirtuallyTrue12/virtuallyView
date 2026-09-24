import { ToolRegistry, type AIMessage } from '@virtuallyview/ai';
import type { RadarrAdapter, SonarrAdapter, LidarrAdapter, BazarrAdapter, QBittorrentAdapter } from '@virtuallyview/integrations';
import { getAdapter } from './registry.js';
import {
  getDownloads,
  pauseDownload,
  resumeDownload,
  removeDownload
} from './real-downloads.js';
import { createRequest, getRequests, cancelRequest, type RequestItem } from './requests.js';
import { OllamaProvider } from './ollama-provider.js';
import { isAllowed, type PermissionLevel } from './ai-permissions.js';
import { recordAiAction } from './ai-history.js';
import { listThemes, setActiveThemeId } from './themes.js';
import { detectIntent, inScope, isConversational, OFF_TOPIC_TEXT } from './ai-router.js';
import { answerIntent } from './ai-answers.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AgentReply =
  | { kind: 'message'; text: string }
  | { kind: 'tool-result'; tool: string; text: string; summary?: unknown }
  | { kind: 'confirmation'; tool: string; arguments: Record<string, unknown>; description: string }
  | { kind: 'error'; message: string };

const TOOL_SPECS: {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  permission: 'read' | 'request' | 'manage' | 'destructive';
  requiresConfirmation?: boolean;
}[] = [
  {
    name: 'search_movies',
    description: 'Search the movie library by title. Returns matching movies with status.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    permission: 'read'
  },
  {
    name: 'library_status',
    description: 'Summarize the library: how many movies are available, missing, requested, and downloading.',
    parameters: { type: 'object', properties: {} },
    permission: 'read'
  },
  {
    name: 'list_downloads',
    description: 'List current downloads with progress, speed, and status.',
    parameters: { type: 'object', properties: {} },
    permission: 'read'
  },
  {
    name: 'pause_download',
    description: 'Pause a download by its id.',
    parameters: { type: 'object', properties: { download_id: { type: 'string' } }, required: ['download_id'] },
    permission: 'manage'
  },
  {
    name: 'resume_download',
    description: 'Resume a paused download by its id.',
    parameters: { type: 'object', properties: { download_id: { type: 'string' } }, required: ['download_id'] },
    permission: 'manage'
  },
  {
    name: 'remove_download',
    description: 'Remove (and stop) a download by its id. This deletes the download entry.',
    parameters: { type: 'object', properties: { download_id: { type: 'string' } }, required: ['download_id'] },
    permission: 'destructive',
    requiresConfirmation: true
  },
  {
    name: 'list_requests',
    description: 'List media requests with their status (pending, searching, downloading, importing, available).',
    parameters: { type: 'object', properties: {} },
    permission: 'read'
  },
  {
    name: 'list_series',
    description: 'List series in the TV library with their status.',
    parameters: { type: 'object', properties: {} },
    permission: 'read'
  },
  {
    name: 'request_movie',
    description:
      'Create a request to add a movie that is not in the library yet. Requires a title.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' }, year: { type: 'integer' } },
      required: ['title']
    },
    permission: 'request',
    requiresConfirmation: true
  },
  {
    name: 'request_series',
    description: 'Create a request to add a TV series that is not in the library yet. Requires a title.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' }, year: { type: 'integer' } },
      required: ['title']
    },
    permission: 'request',
    requiresConfirmation: true
  },
  {
    name: 'request_artist',
    description: 'Create a request to add a music artist that is not in the library yet. Requires a name.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title']
    },
    permission: 'request',
    requiresConfirmation: true
  },
  {
    name: 'cancel_request',
    description: 'Cancel a pending or in-progress request by its id. Requests look like request-001.',
    parameters: { type: 'object', properties: { request_id: { type: 'string' } }, required: ['request_id'] },
    permission: 'manage',
    requiresConfirmation: true
  },
  {
    name: 'get_lidarr_artists',
    description: 'List artists in the music library with their status.',
    parameters: { type: 'object', properties: {} },
    permission: 'read'
  },
  {
    name: 'search_lidarr',
    description: 'Search Lidarr for an artist by name.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    permission: 'read'
  },
  {
    name: 'add_lidarr_artist',
    description: 'Add an artist to Lidarr so their albums get monitored and downloaded.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    permission: 'request',
    requiresConfirmation: true
  },
  {
    name: 'get_missing_subtitles',
    description: 'List movies and episodes that are missing subtitles, via Bazarr.',
    parameters: { type: 'object', properties: {} },
    permission: 'read'
  },
  {
    name: 'download_subtitle',
    description: 'Download a subtitle in a given language for a movie or episode. Ids look like bazarr-movie-123.',
    parameters: {
      type: 'object',
      properties: { media_id: { type: 'string' }, language: { type: 'string' } },
      required: ['media_id', 'language']
    },
    permission: 'manage'
  },
  {
    name: 'get_torrents',
    description: 'List active torrents in qBittorrent with progress and status.',
    parameters: { type: 'object', properties: {} },
    permission: 'read'
  },
  {
    name: 'pause_torrent',
    description: 'Pause a torrent in qBittorrent by its hash.',
    parameters: { type: 'object', properties: { hash: { type: 'string' } }, required: ['hash'] },
    permission: 'manage'
  },
  {
    name: 'resume_torrent',
    description: 'Resume a paused torrent in qBittorrent by its hash.',
    parameters: { type: 'object', properties: { hash: { type: 'string' } }, required: ['hash'] },
    permission: 'manage'
  },
  {
    name: 'remove_torrent',
    description: 'Remove a torrent from qBittorrent by its hash. This does not delete downloaded files.',
    parameters: { type: 'object', properties: { hash: { type: 'string' } }, required: ['hash'] },
    permission: 'destructive',
    requiresConfirmation: true
  },
  {
    name: 'list_themes',
    description: 'List installed themes and which one is currently active.',
    parameters: { type: 'object', properties: {} },
    permission: 'read'
  },
  {
    name: 'change_theme',
    description: 'Switch the active theme by its id (e.g. "oled", "midnight", "light").',
    parameters: { type: 'object', properties: { theme_id: { type: 'string' } }, required: ['theme_id'] },
    permission: 'manage'
  }
];

function normalizeDownloadId(id: string): string {
  const trimmed = String(id ?? '').trim();
  if (/^download-\d+$/i.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `download-${trimmed}`;
  return trimmed;
}

function normalizeRequestId(id: string): string {
  const trimmed = String(id ?? '').trim();
  if (/^request-\d+$/i.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `request-${trimmed}`;
  return trimmed;
}

function buildRegistry(adapter: RadarrAdapter): ToolRegistry {
  const registry = new ToolRegistry();
  for (const spec of TOOL_SPECS) {
    let execute: (a: Record<string, unknown>) => Promise<unknown>;
    switch (spec.name) {
      case 'search_movies':
        execute = async a => (await adapter.search(String(a.query ?? ''))).slice(0, 8);
        break;
      case 'library_status':
        execute = async () => {
          const items = (await adapter.getItems()) as {
            status?: string;
          }[];
          const counts: Record<string, number> = {};
          for (const item of items) {
            counts[item.status ?? 'unknown'] = (counts[item.status ?? 'unknown'] ?? 0) + 1;
          }
          return { total: items.length, counts };
        };
        break;
      case 'list_downloads':
        execute = async () => getDownloads();
        break;
      case 'pause_download':
        execute = async a => pauseDownload(normalizeDownloadId(String(a.download_id)));
        break;
      case 'resume_download':
        execute = async a => resumeDownload(normalizeDownloadId(String(a.download_id)));
        break;
      case 'remove_download':
        execute = async a => removeDownload(normalizeDownloadId(String(a.download_id)));
        break;
      case 'list_requests':
        execute = async () => getRequests();
        break;
      case 'list_series':
        execute = async () => getAdapter<SonarrAdapter>('sonarr').getItems();
        break;
      case 'request_movie':
        execute = async a => {
          const title = String(a.title ?? '');
          const year = typeof a.year === 'number' ? a.year : undefined;
          const result = await createRequest({ title, year, requester: 'you', mediaType: 'movie' });
          if (!result.ok) throw new Error(result.message ?? 'Could not create request.');
          return { ok: true, request: result.request };
        };
        break;
      case 'request_series':
        execute = async a => {
          const title = String(a.title ?? '');
          const year = typeof a.year === 'number' ? a.year : undefined;
          const result = await createRequest({ title, year, requester: 'you', mediaType: 'series' });
          if (!result.ok) throw new Error(result.message ?? 'Could not create request.');
          return { ok: true, request: result.request };
        };
        break;
      case 'request_artist':
        execute = async a => {
          const title = String(a.title ?? '');
          const result = await createRequest({ title, requester: 'you', mediaType: 'artist' });
          if (!result.ok) throw new Error(result.message ?? 'Could not create request.');
          return { ok: true, request: result.request };
        };
        break;
      case 'cancel_request':
        execute = async a => {
          const updated = cancelRequest(normalizeRequestId(String(a.request_id)));
          if (!updated) throw new Error(`Request ${a.request_id} not found.`);
          return updated;
        };
        break;
      case 'get_lidarr_artists':
        execute = async () => getAdapter<LidarrAdapter>('lidarr').getItems();
        break;
      case 'search_lidarr':
        execute = async a => getAdapter<LidarrAdapter>('lidarr').search(String(a.query ?? ''));
        break;
      case 'add_lidarr_artist':
        execute = async a => {
          const result = await getAdapter<LidarrAdapter>('lidarr').add({ title: String(a.name ?? ''), type: 'artist' });
          if (!result.success) throw new Error(result.message);
          return result;
        };
        break;
      case 'get_missing_subtitles':
        execute = async () => getAdapter<BazarrAdapter>('bazarr').getMissingSubtitles();
        break;
      case 'download_subtitle':
        execute = async a => {
          const result = await getAdapter<BazarrAdapter>('bazarr').downloadSubtitle(String(a.media_id ?? ''), String(a.language ?? ''));
          if (!result.success) throw new Error(result.message);
          return result;
        };
        break;
      case 'get_torrents':
        execute = async () => getAdapter<QBittorrentAdapter>('qbittorrent').getQueue();
        break;
      case 'pause_torrent':
        execute = async a => {
          const result = await getAdapter<QBittorrentAdapter>('qbittorrent').pause(String(a.hash ?? ''));
          if (!result.success) throw new Error(result.message);
          return result;
        };
        break;
      case 'resume_torrent':
        execute = async a => {
          const result = await getAdapter<QBittorrentAdapter>('qbittorrent').resume(String(a.hash ?? ''));
          if (!result.success) throw new Error(result.message);
          return result;
        };
        break;
      case 'remove_torrent':
        execute = async a => {
          const result = await getAdapter<QBittorrentAdapter>('qbittorrent').remove(String(a.hash ?? ''));
          if (!result.success) throw new Error(result.message);
          return result;
        };
        break;
      case 'list_themes':
        execute = async () => listThemes().map(t => t.manifest);
        break;
      case 'change_theme':
        execute = async a => setActiveThemeId(String(a.theme_id ?? '')).manifest;
        break;
      default:
        execute = async () => ({});
    }
    registry.register({
      ...spec,
      requiresConfirmation: Boolean(spec.requiresConfirmation),
      execute
    });
  }
  return registry;
}

function toolDescription(name: string, spec: { description: string; parameters: { properties: Record<string, unknown>; required?: string[] }; requiresConfirmation: boolean }): string {
  const params = Object.keys(spec.parameters.properties)
    .map(k => `${k}${spec.parameters.required?.includes(k) ? '*' : ''}`)
    .join(', ');
  return `${name}(${params}) ${spec.requiresConfirmation ? '[requires confirmation] ' : ''}- ${spec.description}`;
}

function buildSystemPrompt(registry: ToolRegistry): string {
  const tools = registry
    .list()
    .map(t => toolDescription(t.name, t))
    .join('\n');
  return [
    'You are the virtuallyView assistant for a home media server (movies, TV, music, downloads, subtitles, themes).',
    'You only answer questions about this server. For anything else reply {"type": "message", "text": "I can only help with your library and its services."}',
    'Respond ONLY with a single JSON object. No prose, no code fences.',
    '',
    'Choose one of two exact shapes:',
    '{"type": "tool_call", "tool": "<name>", "arguments": {<params>}}',
    'or {"type": "message", "text": "<your answer>"}',
    '',
    'Download ids look like download-001. Request ids look like request-001. Always use the full id, never a bare number.',
    'If the user does not give a full id but names a download, first call list_downloads to look it up.',
    'Use a tool when the user asks about or wants to change the library or downloads.',
    'For destructive tools (marked requires confirmation), STILL emit the tool_call.',
    '',
    `Available tools:\n${tools}`,
    '',
    'Keep message text short (under 2 sentences).'
  ].join('\n');
}

function summarizeToolResult(name: string, args: Record<string, unknown>, result: unknown): string {
  switch (name) {
    case 'search_movies': {
      const items = result as { title?: string; year?: number; status?: string }[];
      if (!items.length) return 'No movies matched that search.';
      const lines = items
        .map(m => `- ${m.title} (${m.year ?? '?'}) - ${m.status ?? 'unknown'}`)
        .join('\n');
      return `Found ${items.length}:\n${lines}`;
    }
    case 'library_status': {
      const r = result as { total: number; counts: Record<string, number> };
      const parts = Object.entries(r.counts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return `Library has ${r.total} movies (${parts}).`;
    }
    case 'list_downloads': {
      const downloads = result as { id: string; title: string; progress: number; status: string }[];
      if (!downloads.length) return 'No active downloads.';
      const lines = downloads
        .map(d => `- ${d.title} (${d.id}) ${Math.round(d.progress)}% ${d.status}`)
        .join('\n');
      return `Current downloads:\n${lines}`;
    }
    case 'pause_download':
    case 'resume_download':
    case 'remove_download': {
      const outcome = result as { success: boolean; message: string };
      return outcome.success ? outcome.message : `Action failed: ${outcome.message}`;
    }
    case 'list_requests': {
      const requests = result as RequestItem[];
      if (!requests.length) return 'No requests right now.';
      const lines = requests
        .map(r => `- ${r.title} (${r.year ?? '?'}): ${r.status}${r.progress ? ` ${r.progress}%` : ''}`)
        .join('\n');
      return `Current requests:\n${lines}`;
    }
    case 'list_series': {
      const items = result as { title?: string; year?: number; status?: string }[];
      const lines = items.map(s => `- ${s.title} (${s.year ?? '?'}) - ${s.status ?? 'unknown'}`).join('\n');
      return `TV library has ${items.length} series:\n${lines}`;
    }
    case 'request_movie':
    case 'request_series':
    case 'request_artist': {
      const r = (result as { request?: RequestItem })?.request;
      if (!r) return 'Request could not be created.';
      return `Requested ${r.title}${r.year ? ` (${r.year})` : ''} via ${r.service}. Status: ${r.status}.`;
    }
    case 'cancel_request': {
      const r = result as RequestItem;
      return `Cancelled request ${r.id} (${r.title}).`;
    }
    case 'get_lidarr_artists':
    case 'search_lidarr': {
      const items = result as { title?: string; status?: string }[];
      if (!items.length) return 'No artists found.';
      return `Found ${items.length}:\n${items.map(a => `- ${a.title} - ${a.status ?? 'unknown'}`).join('\n')}`;
    }
    case 'add_lidarr_artist':
      return `Added ${args.name} to Lidarr.`;
    case 'get_missing_subtitles': {
      const items = result as { title: string; missingLanguages: string[] }[];
      if (!items.length) return 'Nothing is missing subtitles.';
      return `Missing subtitles for ${items.length} item(s):\n${items.map(i => `- ${i.title}: ${i.missingLanguages.join(', ') || 'unknown language'}`).join('\n')}`;
    }
    case 'download_subtitle':
      return `Downloaded a ${args.language} subtitle for ${args.media_id}.`;
    case 'get_torrents': {
      const items = result as { title?: string; progress?: number; status?: string }[];
      if (!items.length) return 'No active torrents.';
      return `Torrents:\n${items.map(t => `- ${t.title} ${Math.round(t.progress ?? 0)}% ${t.status}`).join('\n')}`;
    }
    case 'pause_torrent':
      return `Paused torrent ${args.hash}.`;
    case 'resume_torrent':
      return `Resumed torrent ${args.hash}.`;
    case 'remove_torrent':
      return `Removed torrent ${args.hash}.`;
    case 'list_themes': {
      const items = result as { id: string; name: string }[];
      return `Installed themes: ${items.map(t => t.name).join(', ')}.`;
    }
    case 'change_theme': {
      const theme = result as { name: string };
      return `Switched to the ${theme.name} theme.`;
    }
    default:
      return JSON.stringify(result);
  }
}

export class Agent {
  private provider: OllamaProvider;
  private registry: ToolRegistry;
  private adapter: RadarrAdapter;

  constructor() {
    this.provider = new OllamaProvider();
    this.adapter = getAdapter<RadarrAdapter>('radarr');
    this.registry = buildRegistry(this.adapter);
  }

  get providerInfo() {
    return this.provider;
  }

  listTools() {
    return this.registry
      .list()
      .map(t => ({ name: t.name, description: t.description, permission: t.permission, requiresConfirmation: t.requiresConfirmation }));
  }

  async chat(
    message: string,
    args: { history?: ChatMessage[]; confirm?: { tool: string; arguments: Record<string, unknown> } | null } = {}
  ): Promise<AgentReply> {
    // Rules answer the common questions and keep the assistant on topic. A small
    // model only sees what is left, so it cannot get the everyday cases wrong.
    if (!args.confirm) {
      const intent = detectIntent(message);
      if (intent) {
        try {
          const answer = await answerIntent(intent);
          if (answer) return answer;
        } catch (err) {
          return { kind: 'error', message: `I could not check that: ${(err as Error).message}` };
        }
      }
      if (!inScope(message)) return { kind: 'message', text: OFF_TOPIC_TEXT };
    }

    if (!(await this.provider.healthCheck())) {
      return {
        kind: 'error',
        message: 'That question needs the AI model, which is not installed. An administrator can add it with "docker compose --profile ai up -d". Everyday questions still work: try "what is downloading?" or type "help".'
      };
    }

    if (args.confirm) {
      return this.runConfirmedTool(args.confirm.tool, args.confirm.arguments);
    }

    const history: AIMessage[] = (args.history ?? []).map(h => ({ role: h.role, content: h.content }));
    if (isConversational(message)) return this.talk(message, history);
    const messages: AIMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.registry) },
      ...history,
      { role: 'user', content: message }
    ];

    const reply = await this.provider.sendMessage(messages);

    if (reply.toolCalls && reply.toolCalls.length > 0) {
      const call = reply.toolCalls[0];
      const tool = this.registry.get(call.name);
      if (!tool) {
        return {
          kind: 'error',
          message: `The assistant tried to use an unknown tool (${call.name}).`
        };
      }
      if (tool.requiresConfirmation) {
        const description = tool.description;
        return {
          kind: 'confirmation',
          tool: tool.name,
          arguments: call.arguments ?? {},
          description
        };
      }
      const missing = (tool.parameters.required ?? []).some(k => {
        const v = (call.arguments ?? {})[k];
        return v === undefined || v === null || v === '';
      });
      // A small model sometimes grabs a tool for a chatty message and gives it
      // nothing to work with. Talk to the person instead of showing that error.
      if (missing) return this.talk(message, history);
      return this.runTool(tool.name, call.arguments ?? {});
    }

    return { kind: 'message', text: reply.content.trim() || 'Done.' };
  }

  private async talk(message: string, history: AIMessage[]): Promise<AgentReply> {
    const system = [
      'You are the assistant inside virtuallyView, a self-hosted home media server.',
      'Facts you may use: to add a movie, show or artist, open Search, pick the exact match and press Request; Requests shows progress. Downloads shows the queue.',
      'Settings > Indexers controls where searches look. Settings > AI manages models. Wiki (under More) reads offline Wikipedia through Kiwix. Apps (under More) links to Immich, Audiobookshelf and Kavita.',
      'Glossary: Radarr manages movies, Sonarr TV shows, Lidarr music, Bazarr subtitles, Prowlarr keeps the list of indexers (search sources) the others search through, qBittorrent and NZBGet do the downloading.',
      'You cannot see the library in this mode, so never name specific movies or shows as recommendations; suggest browsing Movies or TV instead. Answer in one to three short sentences, plainly. If you do not know, say so. Do not invent menu names or features.'
    ].join('\n');
    try {
      const text = await this.provider.sendPlain([{ role: 'system', content: system }, ...history.slice(-6), { role: 'user', content: message }]);
      return { kind: 'message', text: text || 'I am not sure. Try "help" to see what I can do.' };
    } catch (err) {
      return { kind: 'error', message: `The assistant could not answer: ${(err as Error).message}` };
    }
  }

  private checkPermission(name: string): void {
    const tool = this.registry.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    if (!isAllowed(tool.permission as PermissionLevel)) {
      throw new Error(
        `This action needs the "${tool.permission}" permission level, but the assistant is currently limited below that. Raise it in Settings > AI > Permissions.`
      );
    }
  }

  private async runTool(name: string, args: Record<string, unknown>): Promise<AgentReply> {
    try {
      const validated = this.validate(name, args);
      const tool = this.registry.get(name)!;
      if (!tool) throw new Error(`Tool ${name} not found`);
      if (tool.requiresConfirmation) {
        return {
          kind: 'confirmation',
          tool: name,
          arguments: validated,
          description: tool.description
        };
      }
      this.checkPermission(name);
      const result = await this.registry.execute(name, validated);
      recordAiAction({ tool: name, arguments: validated, success: true, requiredConfirmation: false, message: 'ok' });
      return { kind: 'tool-result', tool: name, text: summarizeToolResult(name, validated, result), summary: result };
    } catch (err) {
      recordAiAction({ tool: name, arguments: args, success: false, requiredConfirmation: false, message: (err as Error).message });
      return { kind: 'error', message: (err as Error).message };
    }
  }

  private async runConfirmedTool(name: string, args: Record<string, unknown>): Promise<AgentReply> {
    try {
      const tool = this.registry.get(name);
      if (!tool) throw new Error(`Tool ${name} not found`);
      this.checkPermission(name);
      const validated = this.validate(name, args);
      const result = await this.registry.execute(name, validated);
      recordAiAction({ tool: name, arguments: validated, success: true, requiredConfirmation: true, message: 'ok' });
      return { kind: 'tool-result', tool: name, text: summarizeToolResult(name, validated, result), summary: result };
    } catch (err) {
      recordAiAction({ tool: name, arguments: args, success: false, requiredConfirmation: true, message: (err as Error).message });
      return { kind: 'error', message: (err as Error).message };
    }
  }

  private validate(name: string, args: Record<string, unknown>): Record<string, unknown> {
    const tool = this.registry.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    const required = tool.parameters.required ?? [];
    for (const key of required) {
      if (args[key] === undefined || args[key] === null || args[key] === '') {
        throw new Error(`Tool ${name} requires argument "${key}".`);
      }
    }
    for (const [key, schema] of Object.entries(tool.parameters.properties)) {
      const value = args[key];
      if (value === undefined || value === null) continue;
      const type = (schema as { type?: string }).type;
      if (type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
        throw new Error(`Tool ${name} argument "${key}" must be a whole number.`);
      }
      if (type === 'string' && typeof value !== 'string') {
        throw new Error(`Tool ${name} argument "${key}" must be text.`);
      }
    }
    return args;
  }
}