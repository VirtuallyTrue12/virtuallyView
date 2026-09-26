import { all, run } from '../db/app-db.js';
import type { CastMember } from './cast.js';

/**
 * An administrator's corrections to a band's member list, kept apart from what
 * MusicBrainz says so a refresh never loses them: mark someone as current or
 * former, take someone off, or add someone missing. Everyone sees these.
 */

export interface MemberEdit { name: string; action: 'set' | 'remove' | 'add'; role?: string; years?: string; current?: boolean; photo?: string }

interface Row { name: string; action: string; role: string | null; years: string | null; current: number | null; photo: string | null }

export function listEdits(artistId: string): MemberEdit[] {
  return all<Row>('SELECT name, action, role, years, current, photo FROM artist_member_edits WHERE artist_id = ?', artistId).map(r => ({
    name: r.name, action: r.action as MemberEdit['action'],
    ...(r.role ? { role: r.role } : {}), ...(r.years ? { years: r.years } : {}),
    ...(r.current !== null ? { current: r.current === 1 } : {}), ...(r.photo ? { photo: r.photo } : {})
  }));
}

export function saveEdit(artistId: string, edit: MemberEdit): void {
  run(`INSERT INTO artist_member_edits (artist_id, name, action, role, years, current, photo) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(artist_id, name) DO UPDATE SET action = excluded.action, role = excluded.role, years = excluded.years, current = excluded.current, photo = excluded.photo`,
  artistId, edit.name, edit.action, edit.role ?? null, edit.years ?? null, edit.current === undefined ? null : edit.current ? 1 : 0, edit.photo ?? null);
}

export function clearEdit(artistId: string, name: string): void {
  run('DELETE FROM artist_member_edits WHERE artist_id = ? AND name = ?', artistId, name);
}

/** The list MusicBrainz gave, with the administrator's corrections applied. Edited people are marked so the page can show it. */
export function applyEdits(members: CastMember[], edits: MemberEdit[]): Array<CastMember & { edited?: boolean }> {
  const byName = new Map(edits.map(e => [e.name.toLowerCase(), e]));
  const out: Array<CastMember & { edited?: boolean }> = [];
  for (const m of members) {
    const e = byName.get(m.name.toLowerCase());
    if (e?.action === 'remove') continue;
    out.push(e?.action === 'set' ? { ...m, ...(e.role !== undefined ? { role: e.role } : {}), ...(e.years !== undefined ? { years: e.years } : {}), ...(e.current !== undefined ? { current: e.current } : {}), edited: true } : m);
  }
  const have = new Set(out.map(m => m.name.toLowerCase()));
  for (const e of edits) {
    if (e.action !== 'add' || have.has(e.name.toLowerCase())) continue;
    out.push({ name: e.name, role: e.role || 'Member', years: e.years ?? '', current: e.current ?? true, photo: e.photo ?? '', edited: true });
  }
  return out.sort((a, b) => Number(b.current ?? true) - Number(a.current ?? true));
}
