import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { castPlay, castStop, castStatus, castControl, type CastPlayOptions, type CastStatus } from './chromecast.js';

// DLNA / UPnP is an open standard that most smart TVs, game consoles and
// media boxes speak. No account, no cloud: this server finds them on the local
// network and tells them which URL to play.

export type CastDevice = { id: string; name: string } & ({ controlUrl: string; host?: undefined } | { host: string; controlUrl?: undefined });

const SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1';
let cache: { at: number; devices: CastDevice[] } | null = null;
export const clearDlnaCache = (): void => { cache = null; };
const CACHE_MS = 60_000;

const idOf = (location: string) => createHash('sha1').update(location).digest('hex').slice(0, 12);
const xmlEscape = (text: string) => text.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c);

function search(timeoutMs: number): Promise<string[]> {
  return new Promise(resolve => {
    const found = new Set<string>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { socket.close(); } catch { /* already closed */ } resolve([...found]); };
    socket.on('error', done);
    socket.on('message', msg => {
      const location = /^location:\s*(\S+)/im.exec(msg.toString())?.[1];
      if (location && /^http:\/\//i.test(location)) found.add(location);
    });
    socket.bind(0, () => {
      const request = Buffer.from(['M-SEARCH * HTTP/1.1', 'HOST: 239.255.255.250:1900', 'MAN: "ssdp:discover"', 'MX: 2', `ST: ${SERVICE}`, '', ''].join('\r\n'));
      for (let i = 0; i < 2; i++) socket.send(request, 1900, '239.255.255.250', () => undefined);
      setTimeout(done, timeoutMs);
    });
  });
}

async function describe(location: string): Promise<CastDevice | null> {
  try {
    const res = await fetch(location, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const xml = await res.text();
    const name = /<friendlyName>([^<]+)<\/friendlyName>/i.exec(xml)?.[1] ?? 'TV';
    const service = new RegExp(`<service>(?:(?!</service>).)*?${SERVICE.replace(/[.:]/g, '\\$&')}(?:(?!</service>).)*?</service>`, 'is').exec(xml)?.[0];
    const control = /<controlURL>([^<]+)<\/controlURL>/i.exec(service ?? '')?.[1];
    if (!control) return null;
    return { id: idOf(location), name, controlUrl: new URL(control, location).toString() };
  } catch {
    return null;
  }
}

/** Renderers and Chromecasts found by the host-network helper (the container cannot reach the home network's multicast). */
function hostFound(): { locations: string[]; cast: CastDevice[] } {
  try {
    const file = path.join(path.dirname(process.env.VV_HOST_NET_FILE ?? '/host-net/addresses.json'), 'renderers.json');
    const data = JSON.parse(readFileSync(file, 'utf8')) as { locations?: unknown; cast?: unknown };
    const locations = Array.isArray(data.locations) ? data.locations.filter((l): l is string => typeof l === 'string' && /^http:\/\//i.test(l)) : [];
    const cast = (Array.isArray(data.cast) ? data.cast : [])
      .filter((c): c is { host: string; name: string } => typeof c?.host === 'string' && /^(10|172|192)\.[\d.]+$/.test(c.host) && typeof c.name === 'string')
      .map(c => ({ id: idOf(`cast:${c.host}`), name: c.name.slice(0, 80), host: c.host }));
    return { locations, cast };
  } catch { return { locations: [], cast: [] }; }
}

export async function discoverDevices(force = false): Promise<CastDevice[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.devices;
  const host = hostFound();
  const locations = [...new Set([...host.locations, ...(await search(2800))])];
  const dlna = (await Promise.all(locations.map(describe))).filter((d): d is CastDevice => d !== null);
  // A TV that speaks both is listed once, through Google Cast (it plays more formats and needs no TV setting).
  const devices = [...host.cast, ...dlna.filter(d => !host.cast.some(c => d.controlUrl?.includes(`//${c.host}:`)))];
  cache = { at: Date.now(), devices };
  return devices;
}

async function soap(device: CastDevice & { controlUrl: string }, action: string, args: string): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${SERVICE}"><InstanceID>0</InstanceID>${args}</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(device.controlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${SERVICE}#${action}"` },
    body,
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`${device.name} refused ${action} (status ${res.status}).`);
  return res.text();
}

/** Parse DLNA RelTime (H:MM:SS) to seconds. */
export function relTimeToSeconds(t: string): number {
  const parts = t.split(':').map(Number);
  if (parts.length === 3) return (parts[0]! * 3600) + (parts[1]! * 60) + (parts[2]! || 0);
  if (parts.length === 2) return (parts[0]! * 60) + (parts[1]! || 0);
  return Number(parts[0]) || 0;
}

/** Format seconds as DLNA RelTime (H:MM:SS). */
export function secondsToRelTime(s: number): string {
  const sec = Math.floor(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const rest = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Only devices found by discovery can be controlled, so this cannot be pointed at other hosts. */
export function knownDevice(id: string): CastDevice | undefined {
  return cache?.devices.find(d => d.id === id);
}

export async function playOnDevice(device: CastDevice, url: string, title: string, opts: CastPlayOptions = {}): Promise<void> {
  if (device.host !== undefined) return castPlay(device.host, url, title, opts);
  const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="0" restricted="1"><dc:title>${xmlEscape(title)}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:video/mp4:*">${xmlEscape(url)}</res></item></DIDL-Lite>`;
  await soap(device, 'SetAVTransportURI', `<CurrentURI>${xmlEscape(url)}</CurrentURI><CurrentURIMetaData>${xmlEscape(didl)}</CurrentURIMetaData>`);
  await soap(device, 'Play', '<Speed>1</Speed>');
}

/** Read the device's current playback state and position. */
export async function deviceStatus(device: CastDevice): Promise<CastStatus | null> {
  if (device.host !== undefined) return castStatus(device.host);
  try {
    const posXml = await soap(device, 'GetPositionInfo', '');
    const currentTime = relTimeToSeconds(/<RelTime>([^<]+)<\/RelTime>/i.exec(posXml)?.[1] ?? '0:00:00');
    const duration = relTimeToSeconds(/<TrackDuration>([^<]+)<\/TrackDuration>/i.exec(posXml)?.[1] ?? '0:00:00');
    const stateXml = await soap(device, 'GetTransportInfo', '');
    const transportState = /<CurrentTransportState>([^<]+)<\/CurrentTransportState>/i.exec(stateXml)?.[1] ?? 'STOPPED';
    let state: CastStatus['state'] = 'IDLE';
    if (transportState === 'PLAYING') state = 'PLAYING';
    else if (transportState === 'PAUSED_PLAYBACK') state = 'PAUSED';
    else if (transportState === 'TRANSITIONING') state = 'BUFFERING';
    return { state, currentTime, duration: duration > 0 ? duration : undefined };
  } catch {
    return null;
  }
}

/** Send play, pause or seek to the device. */
export async function controlDevice(device: CastDevice, action: 'PLAY' | 'PAUSE' | 'SEEK', time?: number): Promise<void> {
  if (device.host !== undefined) return castControl(device.host, action, time);
  if (action === 'PLAY') { await soap(device, 'Play', '<Speed>1</Speed>'); return; }
  if (action === 'PAUSE') { await soap(device, 'Pause', ''); return; }
  if (action === 'SEEK' && time !== undefined) {
    await soap(device, 'Seek', `<Unit>REL_TIME</Unit><Target>${xmlEscape(secondsToRelTime(time))}</Target>`);
    return;
  }
}

/** Stop the device; returns the position the device had reached (0 if it could not be read). */
export async function stopDevice(device: CastDevice): Promise<number> {
  if (device.host !== undefined) return castStop(device.host);
  let position = 0;
  try {
    const xml = await soap(device, 'GetPositionInfo', '');
    position = relTimeToSeconds(/<RelTime>([^<]+)<\/RelTime>/i.exec(xml)?.[1] ?? '0:00:00');
  } catch { /* best effort */ }
  await soap(device, 'Stop', '').catch(() => undefined);
  return position;
}
