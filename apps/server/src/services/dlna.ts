import dgram from 'node:dgram';
import { createHash } from 'node:crypto';

// DLNA / UPnP is an open standard that most smart TVs, game consoles and
// media boxes speak. No account, no cloud: this server finds them on the local
// network and tells them which URL to play.

export interface CastDevice { id: string; name: string; controlUrl: string }

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

export async function discoverDevices(force = false): Promise<CastDevice[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.devices;
  const locations = await search(2800);
  const devices = (await Promise.all(locations.map(describe))).filter((d): d is CastDevice => d !== null);
  cache = { at: Date.now(), devices };
  return devices;
}

async function soap(device: CastDevice, action: string, args: string): Promise<void> {
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${SERVICE}"><InstanceID>0</InstanceID>${args}</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(device.controlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${SERVICE}#${action}"` },
    body,
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) throw new Error(`${device.name} refused ${action} (status ${res.status}).`);
}

/** Only devices found by discovery can be controlled, so this cannot be pointed at other hosts. */
export function knownDevice(id: string): CastDevice | undefined {
  return cache?.devices.find(d => d.id === id);
}

export async function playOnDevice(device: CastDevice, url: string, title: string): Promise<void> {
  const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="0" restricted="1"><dc:title>${xmlEscape(title)}</dc:title><upnp:class>object.item.videoItem</upnp:class><res protocolInfo="http-get:*:video/mp4:*">${xmlEscape(url)}</res></item></DIDL-Lite>`;
  await soap(device, 'SetAVTransportURI', `<CurrentURI>${xmlEscape(url)}</CurrentURI><CurrentURIMetaData>${xmlEscape(didl)}</CurrentURIMetaData>`);
  await soap(device, 'Play', '<Speed>1</Speed>');
}

export async function stopDevice(device: CastDevice): Promise<void> {
  await soap(device, 'Stop', '');
}
