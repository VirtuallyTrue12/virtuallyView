import { beforeEach, describe, expect, it } from 'vitest';
import * as listen from '../../apps/server/src/services/listen-session';

const entry = (id: number, title = `Song ${id}`) => ({ track: { id, title, durationMs: 200_000 }, artistTitle: 'Artist', albumTitle: 'Album' });
const host = { userId: 'ana', name: 'Ana' };
const sam = { userId: 'sam', name: 'Sam' };
const kim = { userId: 'kim', name: 'Kim' };
const T0 = 1_000_000;

function start(now = T0) {
  const out = listen.createSession(host, { queue: [entry(1), entry(2), entry(3)], index: 0, position: 0, playing: true }, now);
  if (!out.ok) throw new Error(out.message);
  return out.value.code;
}

describe('listen together: sessions', () => {
  beforeEach(() => listen.resetListenSessions());

  it('creates a session with the host as the only member, and starts playing from the given point', () => {
    const code = start();
    const s = listen.getSession(code, T0)!;
    expect(s.host).toBe('ana');
    expect(s.members.map(m => m.userId)).toEqual(['ana']);
    expect(s.playing).toBe(true);
    expect(s.queue).toHaveLength(3);
  });

  it('refuses an empty queue', () => {
    const out = listen.createSession(host, { queue: [] }, T0);
    expect(out.ok).toBe(false);
  });

  it('lets someone join, and joining twice is harmless', () => {
    const code = start();
    listen.joinSession(code, sam, T0 + 1);
    listen.joinSession(code, sam, T0 + 2);
    expect(listen.getSession(code, T0)!.members.map(m => m.userId)).toEqual(['ana', 'sam']);
  });

  it('answers 404 for a code that does not exist', () => {
    const out = listen.joinSession('NOPE00', sam, T0);
    expect(out).toMatchObject({ ok: false, status: 404 });
  });

  it('hands the host to the member who joined first when the host leaves', () => {
    const code = start();
    listen.joinSession(code, sam, T0 + 1);
    listen.joinSession(code, kim, T0 + 2);
    const out = listen.leaveSession(code, 'ana', T0 + 3);
    expect(out.ok).toBe(true);
    const s = listen.getSession(code, T0 + 3)!;
    expect(s.host).toBe('sam');
    expect(s.members.map(m => m.userId)).toEqual(['sam', 'kim']);
  });

  it('keeps the host when a plain member leaves', () => {
    const code = start();
    listen.joinSession(code, sam, T0 + 1);
    listen.leaveSession(code, 'sam', T0 + 2);
    expect(listen.getSession(code, T0 + 2)!.host).toBe('ana');
  });

  it('ends the session once the last member has left', () => {
    const code = start();
    const out = listen.leaveSession(code, 'ana', T0 + 1);
    expect(out.ok && out.value.session).toBeNull();
    expect(listen.getSession(code, T0 + 1)).toBeNull();
  });

  it('ends a session after six hours with no activity, and keeps it alive while people use it', () => {
    const code = start();
    const sixHours = listen.SESSION_IDLE_MS;
    // Activity at the five-hour mark pushes the expiry out.
    listen.applyCommand(code, 'ana', { type: 'pause' }, T0 + sixHours - 1000 * 60 * 60);
    expect(listen.getSession(code, T0 + sixHours + 1000)).not.toBeNull();
    expect(listen.expireSessions(T0 + sixHours * 3)).toEqual([code]);
    expect(listen.getSession(code, T0 + sixHours * 3)).toBeNull();
  });

  it('expires a silent session on read, without waiting for the sweep', () => {
    const code = start();
    expect(listen.getSession(code, T0 + listen.SESSION_IDLE_MS + 1)).toBeNull();
  });
});

describe('listen together: permissions', () => {
  beforeEach(() => listen.resetListenSessions());

  it('lets every member add songs, but not skip, reorder or remove them', () => {
    const code = start();
    listen.joinSession(code, sam, T0);
    expect(listen.applyCommand(code, 'sam', { type: 'add', entries: [entry(9)] }, T0)).toMatchObject({ ok: true });
    expect(listen.getSession(code, T0)!.queue).toHaveLength(4);
    expect(listen.applyCommand(code, 'sam', { type: 'skip', index: 2 }, T0)).toMatchObject({ ok: false, status: 403 });
    expect(listen.applyCommand(code, 'sam', { type: 'move', from: 0, to: 2 }, T0)).toMatchObject({ ok: false, status: 403 });
    expect(listen.applyCommand(code, 'sam', { type: 'remove', index: 0 }, T0)).toMatchObject({ ok: false, status: 403 });
    expect(listen.applyCommand(code, 'sam', { type: 'pause' }, T0)).toMatchObject({ ok: false, status: 403 });
  });

  it('lets the host skip, reorder and control playback', () => {
    const code = start();
    listen.joinSession(code, sam, T0);
    expect(listen.applyCommand(code, 'ana', { type: 'skip', index: 1 }, T0)).toMatchObject({ ok: true });
    expect(listen.getSession(code, T0)!.index).toBe(1);
    expect(listen.applyCommand(code, 'ana', { type: 'move', from: 2, to: 0 }, T0)).toMatchObject({ ok: true });
    expect(listen.applyCommand(code, 'ana', { type: 'pause' }, T0)).toMatchObject({ ok: true });
    expect(listen.getSession(code, T0)!.playing).toBe(false);
  });

  it('lets members control playback once the host turns on everyone-control, and only the host can turn it on', () => {
    const code = start();
    listen.joinSession(code, sam, T0);
    expect(listen.applyCommand(code, 'sam', { type: 'everyone', on: true }, T0)).toMatchObject({ ok: false, status: 403 });
    expect(listen.applyCommand(code, 'ana', { type: 'everyone', on: true }, T0)).toMatchObject({ ok: true });
    expect(listen.applyCommand(code, 'sam', { type: 'skip', index: 2 }, T0)).toMatchObject({ ok: true });
    expect(listen.getSession(code, T0)!.index).toBe(2);
  });

  it('refuses commands from someone who has not joined', () => {
    const code = start();
    expect(listen.applyCommand(code, 'kim', { type: 'add', entries: [entry(5)] }, T0)).toMatchObject({ ok: false, status: 403 });
  });

  it('keeps the host controls with the new host after a handover', () => {
    const code = start();
    listen.joinSession(code, sam, T0);
    listen.leaveSession(code, 'ana', T0 + 1);
    expect(listen.applyCommand(code, 'ana', { type: 'pause' }, T0 + 2)).toMatchObject({ ok: false, status: 403 });
    expect(listen.applyCommand(code, 'sam', { type: 'pause' }, T0 + 2)).toMatchObject({ ok: true });
  });
});

describe('listen together: playback position', () => {
  beforeEach(() => listen.resetListenSessions());

  it('moves the position on while playing, and holds it while paused', () => {
    const code = start();
    listen.applyCommand(code, 'ana', { type: 'seek', position: 30 }, T0);
    const s = listen.getSession(code, T0)!;
    expect(listen.positionAt(s, T0 + 5_000)).toBeCloseTo(35, 5);
    listen.applyCommand(code, 'ana', { type: 'pause' }, T0 + 5_000);
    expect(listen.positionAt(listen.getSession(code, T0 + 9_000)!, T0 + 9_000)).toBeCloseTo(35, 5);
  });

  it('starts a track from zero on skip, and bumps the sequence every time', () => {
    const code = start();
    const before = listen.getSession(code, T0)!.seq;
    listen.applyCommand(code, 'ana', { type: 'skip', index: 1 }, T0 + 4_000);
    const s = listen.getSession(code, T0 + 4_000)!;
    expect(s.position).toBe(0);
    expect(s.seq).toBe(before + 1);
  });

  it('keeps the playing index right when a row before it is removed', () => {
    const code = start();
    listen.applyCommand(code, 'ana', { type: 'skip', index: 2 }, T0);
    listen.applyCommand(code, 'ana', { type: 'remove', index: 0 }, T0);
    expect(listen.getSession(code, T0)!.index).toBe(1);
    expect(listen.getSession(code, T0)!.queue.map(e => e.track.id)).toEqual([2, 3]);
  });

  it('drops rows without a usable track id when a queue is sent', () => {
    expect(listen.sanitizeQueue([{ track: { title: 'no id' } }, entry(4), null, 'x'])).toHaveLength(1);
  });
});
