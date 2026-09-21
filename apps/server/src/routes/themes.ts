import type { FastifyInstance } from 'fastify';
import { tokensToCssVars } from '@virtuallyview/themes';
import {
  listThemes,
  getTheme,
  getActiveTheme,
  setActiveThemeId,
  getActiveThemeId,
  saveCustomTheme,
  deleteCustomTheme,
  isCustomTheme
} from '../services/themes.js';

interface ThemeSummaryDto {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  active: boolean;
  categories: string[];
  mode: 'dark' | 'light';
  custom: boolean;
  cssVars: Record<string, string>;
}

const modeOf = (categories: string[] | undefined): 'dark' | 'light' => (categories ?? []).includes('light') ? 'light' : 'dark';

export default async function themeRoutes(server: FastifyInstance) {
  server.get('/api/themes', async () => {
    const activeId = getActiveThemeId();
    const themes = listThemes();
    const out: ThemeSummaryDto[] = themes.map(t => ({
      id: t.manifest.id,
      name: t.manifest.name,
      version: t.manifest.version,
      author: t.manifest.author,
      description: t.manifest.description,
      active: t.manifest.id === activeId,
      categories: t.manifest.categories ?? [],
      mode: modeOf(t.manifest.categories),
      custom: isCustomTheme(t.manifest.id),
      cssVars: tokensToCssVars(t.tokens)
    }));
    return out;
  });

  server.get('/api/themes/active', async () => {
    const theme = getActiveTheme();
    return {
      manifest: theme.manifest,
      cssVars: tokensToCssVars(theme.tokens),
      id: theme.manifest.id,
      mode: modeOf(theme.manifest.categories)
    };
  });

  server.get<{ Params: { id: string } }>('/api/themes/:id', async (request, reply) => {
    const { id } = request.params;
    const theme = getTheme(id);
    if (!theme) {
      return reply.code(404).send({ error: 'not_found', message: `No theme found with id "${id}".` });
    }
    return {
      manifest: theme.manifest,
      cssVars: tokensToCssVars(theme.tokens),
      mode: modeOf(theme.manifest.categories),
      active: theme.manifest.id === getActiveThemeId()
    };
  });

  server.post<{ Params: { id: string } }>('/api/themes/:id/activate', async (request, reply) => {
    const { id } = request.params;
    try {
      const theme = setActiveThemeId(id);
      return { success: true, activeTheme: id, cssVars: tokensToCssVars(theme.tokens) };
    } catch (err) {
      return reply.code(404).send({ error: 'not_found', message: (err as Error).message });
    }
  });

  // Import or save a custom theme package (admin only, enforced globally for writes).
  server.post<{ Body: { theme?: unknown; tokens?: unknown } }>('/api/themes/import', async (request, reply) => {
    try {
      const saved = saveCustomTheme(request.body?.theme as never, request.body?.tokens as never);
      return { success: true, id: saved.manifest.id, name: saved.manifest.name };
    } catch (err) {
      return reply.code(400).send({ success: false, message: (err as Error).message });
    }
  });

  server.delete<{ Params: { id: string } }>('/api/themes/:id', async (request, reply) => {
    if (!deleteCustomTheme(request.params.id)) {
      return reply.code(404).send({ message: 'Only themes you imported or created can be removed.' });
    }
    return { success: true };
  });
}
