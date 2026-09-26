import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VV_DATA_DIR = mkdtempSync(join(tmpdir(), 'vv-cast-'));

const card = (order: number, id: number, name: string, role: string, episodes: number) => `
      <li data-order="${order}">
        <a href="/person/${id}-x"><div class="glyphicons picture"><img loading="lazy" class="profile w-full" src="https://media.themoviedb.org/t/p/w66_and_h66_face/photo${id}.jpg" srcset="a 1x" alt="${name}"></div></a>
        <div><p><a href="/person/${id}-x">${name}</a></p><p class="roles"><a href="/tv/1/c?x=1">${role}</a> <span>(${episodes} Episodes)</span></p></div>
      </li>`;
const page = `<h3>Series Cast <span>1047</span></h3><ol class="people credits ">${[
  card(0, 1, 'Josh Radnor', 'Ted Mosby', 208), card(1, 2, 'Neil Patrick Harris', 'Barney Stinson', 208), card(2, 3, 'Lyndsy Fonseca', 'Penny', 18),
  card(3, 4, 'Marshall Manesh', 'Ranjit', 24), card(4, 5, 'Josh Radnor', 'again', 1), card(5, 6, "Conan O'Brien", 'Himself', 2)
].join('')}</ol>`;

describe('TV cast', () => {
  it('lists people in billing order, with characters, portraits and episode counts, leads before supporting', async () => {
    const { parseTvCastPage } = await import('../../apps/server/src/services/cast-more.js');
    const cast = parseTvCastPage(page);
    expect(cast.map(c => c.name)).toEqual(['Josh Radnor', 'Neil Patrick Harris', 'Lyndsy Fonseca', 'Marshall Manesh', "Conan O'Brien"]);
    expect(cast[0]).toMatchObject({ role: 'Ted Mosby', episodes: 208, group: 'main', photo: 'https://media.themoviedb.org/t/p/w138_and_h175_face/photo1.jpg' });
    expect(cast.filter(c => c.group === 'main').map(c => c.name)).toEqual(['Josh Radnor', 'Neil Patrick Harris']);
    expect(cast.find(c => c.name === 'Lyndsy Fonseca')?.group).toBe('supporting');
  });
});

describe('band members', () => {
  it('lists members with what they play and when, current members first', async () => {
    const { parseMembers } = await import('../../apps/server/src/services/cast-more.js');
    const members = parseMembers([
      { type: 'member of band', direction: 'backward', begin: '1996', end: '2017', ended: true, attributes: ['lead vocals'], artist: { name: 'Chester Bennington' } },
      { type: 'member of band', direction: 'backward', begin: '1996', end: null, ended: false, attributes: ['guitar', 'rhythm'], artist: { name: 'Mike Shinoda' } },
      { type: 'member of band', direction: 'forward', artist: { name: 'Some Other Band' } },
      { type: 'producer', direction: 'backward', artist: { name: 'Rick Rubin' } },
      { type: 'member of band', direction: 'backward', begin: '2023', ended: false, attributes: [], artist: { name: 'Emily Armstrong' } },
      { type: 'member of band', direction: 'backward', artist: { name: 'Mike Shinoda' } }
    ]);
    expect(members.map(m => m.name)).toEqual(['Mike Shinoda', 'Emily Armstrong', 'Chester Bennington']);
    expect(members[0]).toMatchObject({ role: 'guitar', years: '1996–present', current: true });
    expect(members[2]).toMatchObject({ role: 'lead vocals', years: '1996–2017', current: false });
    expect(members[1]!.role).toBe('Member');
  });

  it('tries the names Wikipedia actually uses', async () => {
    const { portraitTitles } = await import('../../apps/server/src/services/cast-more.js');
    expect(portraitTitles('Joseph “Joe” Hahn').slice(0, 3)).toEqual(['Joseph “Joe” Hahn', 'Joe Hahn', 'Joseph Hahn']);
    expect(portraitTitles('Mark Wakefield')).toContain('Mark Wakefield (musician)');
    expect(portraitTitles('Nick Mason')[0]).toBe('Nick Mason');
  });

  it('shows a solo artist as themselves, and only attaches a portrait from a musician\'s page', async () => {
    const { fetchBand } = await import('../../apps/server/src/services/cast-more.js');
    const { vi } = await import('vitest');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('musicbrainz.org')) return new Response(JSON.stringify({ type: 'Person', relations: [] }), { status: 200 });
      if (u.includes('wikipedia.org')) return new Response(JSON.stringify({ type: 'standard', description: 'American rapper and singer', thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' } }), { status: 200 });
      return new Response('{}', { status: 404 });
    }));
    const solo = await fetchBand('mbid', 'Juice WRLD');
    vi.unstubAllGlobals();
    expect(solo.kind).toBe('solo');
    expect(solo.members).toEqual([{ name: 'Juice WRLD', role: 'Artist', photo: 'https://upload.wikimedia.org/x.jpg', current: true }]);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('wikipedia.org')
      ? new Response(JSON.stringify({ type: 'standard', description: 'Village in Somerset, England', thumbnail: { source: 'https://upload.wikimedia.org/village.jpg' } }), { status: 200 })
      : new Response(JSON.stringify({ type: 'Person', relations: [] }), { status: 200 })));
    const namesake = await fetchBand('mbid', 'Adele');
    vi.unstubAllGlobals();
    expect(namesake.members[0]!.photo).toBe('');
  });
});
