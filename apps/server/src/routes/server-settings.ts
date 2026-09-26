import type { FastifyInstance } from 'fastify';
import { getServerSettings, saveServerSettings, type ServerSettings } from '../services/server-settings.js';
import { probeOutboundProxy } from '../services/outbound.js';
import { sanitizeChannels } from '../services/notifications.js';
import { currentActor } from '../services/user-context.js';
import { recordSettingsDiff } from '../services/settings-history.js';

const VALID_LOG_LEVELS = new Set(['error', 'warn', 'info', 'debug']);
const VALID_COVER_SOURCES = new Set(['tmdb', 'duckduckgo', 'wikipedia']);
const VALID_PROXY_KINDS = new Set(['tor', 'socks5', 'http']);

const CONFIRMATION_PHRASES: Record<string, string> = {
  movies: 'change movie folder',
  tv: 'change tv folder',
  music: 'change music folder',
  staging: 'change staging folder'
};

export default async function serverSettingsRoutes(server: FastifyInstance) {
  server.get('/api/server-settings', async () => {
    const settings = getServerSettings();
    // Channel URLs and tokens are secrets: only administrators see them.
    return currentActor().role === 'user'
      ? { ...settings, notifications: { channels: [] }, outboundProxy: { ...settings.outboundProxy, host: '' }, mediaRoots: { movies: '', tv: '', music: '', staging: '' } }
      : settings;
  });

  server.post<{ Body: Partial<ServerSettings> & { confirm?: string } }>(
    '/api/server-settings',
    async (request, reply) => {
      const body = request.body ?? {};
      if (body.logLevel !== undefined && !VALID_LOG_LEVELS.has(body.logLevel)) {
        return reply.code(400).send({ message: 'Log level must be error, warn, info or debug.' });
      }
      if (body.coverSource !== undefined && !VALID_COVER_SOURCES.has(body.coverSource)) {
        return reply.code(400).send({ message: 'Cover source must be tmdb, duckduckgo or wikipedia.' });
      }
      if (body.port !== undefined && (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535)) {
        return reply.code(400).send({ message: 'Port must be an integer between 1 and 65535.' });
      }
      if (body.outboundProxy?.kind !== undefined && !VALID_PROXY_KINDS.has(body.outboundProxy.kind)) {
        return reply.code(400).send({ message: 'Proxy kind must be tor, socks5 or http.' });
      }
      if (typeof body.publicUrl === 'string' && body.publicUrl.trim() !== '' && !/^https?:\/\/[^\s/]+(:\d+)?(\/.*)?$/i.test(body.publicUrl.trim())) {
        return reply.code(400).send({ message: 'Address must look like http://192.168.1.20:3000.' });
      }
      if (body.requests) {
        const r = body.requests;
        if ((r.approval !== undefined && !['off', 'users'].includes(r.approval)) || (r.window !== undefined && !['day', 'week'].includes(r.window)) ||
            (r.limit !== undefined && (!Number.isInteger(r.limit) || r.limit < 0 || r.limit > 1000))) {
          return reply.code(400).send({ message: 'Request settings are not valid.' });
        }
      }
      let channels: ReturnType<typeof sanitizeChannels> | undefined;
      if (body.notifications) {
        try { channels = sanitizeChannels(body.notifications.channels); } catch (err) { return reply.code(400).send({ message: (err as Error).message }); }
      }
      if (typeof body.serverName === 'string' && body.serverName.trim().length === 0) {
        return reply.code(400).send({ message: 'Server name cannot be empty.' });
      }

      // Media roots are a breaking change to where media is stored. Require the
      // exact confirmation phrase for each changed path so a stray edit cannot
      // silently redirect the whole library. This is what makes the folders
      // section safe to have on a settings screen.
      const current = getServerSettings();
      const roots = body.mediaRoots ?? {};
      for (const key of Object.keys(roots) as (keyof typeof CONFIRMATION_PHRASES)[]) {
        const nextVal = (roots as Record<string, string>)[key];
        if (nextVal === undefined) continue;
        if (nextVal.trim().length === 0) {
          return reply.code(400).send({ message: 'Media folders cannot be empty.' });
        }
        if (current.mediaRoots[key as keyof typeof current.mediaRoots] !== nextVal.trim()) {
          const expected = CONFIRMATION_PHRASES[key];
          if ((body.confirm ?? '').trim().toLowerCase() !== expected) {
            return reply.code(422).send({
              message: `Changing the ${key} folder requires typing the confirmation phrase "${expected}".`,
              code: 'confirmation_required',
              phrase: expected
            });
          }
        }
      }

      try {
        const settings = saveServerSettings({
          serverName: body.serverName,
          mediaRoots: roots as ServerSettings['mediaRoots'],
          logLevel: body.logLevel,
          bindAddress: body.bindAddress,
          port: body.port !== undefined ? Number(body.port) : undefined,
          folderChangeRequiresConfirmation: body.folderChangeRequiresConfirmation,
          coverSource: body.coverSource,
          outboundProxy: body.outboundProxy,
          ...(body.requests ? { requests: body.requests } : {}),
          ...(channels ? { notifications: { channels } } : {}),
          ...(typeof body.autoBackup === 'boolean' ? { autoBackup: body.autoBackup } : {}),
          ...(body.defaultQuality && typeof body.defaultQuality === 'object' ? { defaultQuality: body.defaultQuality } : {}),
          ...(typeof body.allowSignup === 'boolean' ? { allowSignup: body.allowSignup } : {}),
          ...(typeof body.trustLocalNetwork === 'boolean' ? { trustLocalNetwork: body.trustLocalNetwork } : {}),
          ...(typeof body.publicUrl === 'string' ? { publicUrl: body.publicUrl.trim().replace(/\/+$/, '') } : {})
        });
        recordSettingsDiff(current, settings);
        return settings;
      } catch {
        return reply.code(500).send({ message: 'Could not save server settings.' });
      }
    }
  );

  // Live check of the configured outbound proxy, for the Settings test button.
  server.get('/api/server-settings/proxy-test', async () => probeOutboundProxy());

  // First-run onboarding state. Required until the user completes or skips it.
  server.get('/api/onboarding', async () => ({ required: !getServerSettings().onboardingComplete }));

  server.post<{ Body: { complete?: boolean } }>('/api/onboarding', async (request) => {
    const complete = request.body?.complete === true;
    const saved = saveServerSettings({ onboardingComplete: complete });
    return { required: !saved.onboardingComplete };
  });
}