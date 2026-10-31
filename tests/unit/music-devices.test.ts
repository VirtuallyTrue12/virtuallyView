import { beforeEach, describe, expect, it } from 'vitest';
import * as devices from '../../apps/server/src/services/music-devices';

const T0 = 2_000_000;
const PHONE = 'phone-aaaa11';
const TV = 'tv-bbbb22';

describe('play on another device: heartbeats', () => {
  beforeEach(() => devices.resetDevices());

  it('lists a device that has sent a heartbeat, for its own account', () => {
    devices.heartbeat('ana', { id: PHONE, name: 'Safari on iPhone' }, T0);
    expect(devices.listLive('ana', T0 + 1000).map(d => d.name)).toEqual(['Safari on iPhone']);
  });

  it('drops a device that has gone 30 seconds without a heartbeat', () => {
    devices.heartbeat('ana', { id: PHONE, name: 'Safari on iPhone' }, T0);
    expect(devices.listLive('ana', T0 + 29_000)).toHaveLength(1);
    expect(devices.listLive('ana', T0 + 30_000)).toHaveLength(0);
  });

  it('keeps a device listed while its heartbeats keep arriving', () => {
    devices.heartbeat('ana', { id: PHONE, name: 'Safari on iPhone' }, T0);
    devices.heartbeat('ana', { id: PHONE }, T0 + 25_000);
    expect(devices.listLive('ana', T0 + 50_000)).toHaveLength(1);
    expect(devices.listLive('ana', T0 + 50_000)[0]!.name).toBe('Safari on iPhone');
  });

  it('keeps the last name when a heartbeat does not send one', () => {
    devices.heartbeat('ana', { id: TV, name: 'TV browser' }, T0);
    devices.heartbeat('ana', { id: TV }, T0 + 1);
    expect(devices.listLive('ana', T0 + 2)[0]!.name).toBe('TV browser');
  });

  it('removes the dead records on purge, so nothing lingers', () => {
    devices.heartbeat('ana', { id: PHONE, name: 'Safari on iPhone' }, T0);
    devices.purgeDevices(T0 + devices.DEVICE_TTL_MS + 1);
    expect(devices.controlTarget('ana', PHONE, T0 + devices.DEVICE_TTL_MS + 1)).toMatchObject({ ok: false, status: 404 });
  });

  it('keeps the reported playback state and drops anything malformed', () => {
    const state = devices.sanitizeState({ playing: true, position: 12, duration: 200, index: 1, queueLength: 4, title: 'Song', volume: 3, blocked: false });
    expect(state).toMatchObject({ playing: true, position: 12, volume: 1 });
    expect(devices.sanitizeState('nope')).toBeNull();
    expect(devices.sanitizeState({ playing: 'yes' })?.playing).toBe(false);
  });
});

describe('play on another device: same account only', () => {
  beforeEach(() => devices.resetDevices());

  it('lets the owning account control its device', () => {
    devices.heartbeat('ana', { id: TV, name: 'TV browser' }, T0);
    expect(devices.controlTarget('ana', TV, T0 + 1)).toMatchObject({ ok: true, value: { id: TV, userId: 'ana' } });
  });

  it('refuses another account controlling that device, as if it were not there', () => {
    devices.heartbeat('ana', { id: TV, name: 'TV browser' }, T0);
    expect(devices.controlTarget('sam', TV, T0 + 1)).toMatchObject({ ok: false, status: 404 });
    expect(devices.listLive('sam', T0 + 1)).toEqual([]);
  });

  it('does not let another account overwrite a device by reusing its id', () => {
    devices.heartbeat('ana', { id: TV, name: 'TV browser' }, T0);
    devices.heartbeat('sam', { id: TV, name: 'Hijacked' }, T0 + 1);
    expect(devices.listLive('ana', T0 + 2)[0]!.name).toBe('TV browser');
    expect(devices.listLive('sam', T0 + 2)[0]!.name).toBe('Hijacked');
    expect(devices.controlTarget('sam', TV, T0 + 2)).toMatchObject({ ok: true, value: { userId: 'sam' } });
  });

  it('refuses a control target that is offline, even for its owner', () => {
    devices.heartbeat('ana', { id: TV, name: 'TV browser' }, T0);
    expect(devices.controlTarget('ana', TV, T0 + 30_000)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('play on another device: commands', () => {
  it('accepts the commands a device understands, clamping volume', () => {
    expect(devices.sanitizeCommand({ type: 'play' })).toEqual({ type: 'play' });
    expect(devices.sanitizeCommand({ type: 'volume', value: 4 })).toEqual({ type: 'volume', value: 1 });
    expect(devices.sanitizeCommand({ type: 'seek', position: 61 })).toEqual({ type: 'seek', position: 61 });
  });

  it('refuses commands it does not know, and a handover with nothing to play', () => {
    expect(devices.sanitizeCommand({ type: 'format-disk' })).toBeNull();
    expect(devices.sanitizeCommand({ type: 'load', queue: [], index: 0, position: 0, playing: true })).toBeNull();
    expect(devices.sanitizeCommand({ type: 'seek', position: -3 })).toBeNull();
  });
});
