import type { FastifyInstance } from 'fastify';
import type { Media } from '@virtuallyview/types';
import { all } from '../db/app-db.js';
import { getAdapter } from '../services/registry.js';
import { filterByRating } from '../services/parental.js';
import { outboundFetch } from '../services/outbound.js';

interface Bio { bio?: string; photo?: string; url?: string }
const bios = new Map<string, { at: number; value: Bio }>();
const BIO_TTL = 24 * 60 * 60 * 1000;

async function wikipedia(name: string): Promise<Bio> {
  const key = name.toLowerCase();
  const hit = bios.get(key);
  if (hit && Date.now() - hit.at < BIO_TTL) return hit.value;
  let value: Bio = {};
  try {
    const res = await outboundFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`, {
      headers: { 'User-Agent': 'virtuallyView/1.0 (self-hosted media dashboard)' }, timeoutMs: 8000
    });
    if (res.ok) {
      const body = (await res.json()) as { type?: string; extract?: string; thumbnail?: { source?: string }; content_urls?: { desktop?: { page?: string } } };
      if (body.type === 'standard' && body.extract) {
        value = { bio: body.extract, ...(body.thumbnail?.source ? { photo: body.thumbnail.source } : {}), ...(body.content_urls?.desktop?.page ? { url: body.content_urls.desktop.page } : {}) };
      }
    }
  } catch { /* offline: show what the library knows */ }
  bios.set(key, { at: Date.now(), value });
  return value;
}

/**
 * A person's page: their picture and a short biography, and every title in this
 * library they appear in. Cast lists are read from what the library has already
 * looked up, so a title appears here once its own page has been opened.
 */
export default async function peopleRoutes(server: FastifyInstance) {
  server.get<{ Params: { name: string } }>('/api/people/:name', async (request, reply) => {
    const name = request.params.name.trim().slice(0, 100);
    if (!name) return reply.code(400).send({ message: 'A name is required.' });
    const wanted = name.toLowerCase();
    const roles = new Map<string, { role: string; photo?: string }>();
    for (const row of all<{ media_id: string; payload: string }>('SELECT media_id, payload FROM cast_cache')) {
      try {
        const parsed = JSON.parse(row.payload) as { cast?: Array<{ name: string; role?: string; photo?: string }> };
        const member = parsed.cast?.find(c => c.name?.toLowerCase() === wanted);
        if (member) roles.set(row.media_id, { role: member.role ?? '', ...(member.photo ? { photo: member.photo } : {}) });
      } catch { /* skip unreadable row */ }
    }
    let library: Media[] = [];
    try { library = filterByRating(await getAdapter('radarr').getItems()); } catch { /* Radarr offline */ }
    const titles = library.filter(m => roles.has(m.id)).map(m => ({ ...m, role: roles.get(m.id)?.role ?? '' }));
    const photo = [...roles.values()].find(r => r.photo)?.photo;
    const info = await wikipedia(name);
    if (!titles.length && !info.bio) return reply.code(404).send({ message: `Nothing is known about "${name}" yet.` });
    return { name, photo: photo ?? info.photo, bio: info.bio, url: info.url, titles };
  });
}
