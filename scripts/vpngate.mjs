#!/usr/bin/env node
/**
 * Picks a free public relay from VPN Gate (an academic project of the
 * University of Tsukuba; needs no account) and writes its OpenVPN config for
 * gluetun.
 *
 *   node scripts/vpngate.mjs /gluetun/custom.ovpn [country code]          pick once
 *   node scripts/vpngate.mjs /gluetun/custom.ovpn [country code] --watch   keep it healthy
 *
 * Relays are run by volunteers and come and go, so --watch checks the chosen relay every minute -
 * both that it still answers the OpenVPN handshake, and that real traffic actually gets through
 * gluetun's proxy with it - and writes a fresh one when either fails twice in a row (gluetun re-reads
 * the file when it restarts the tunnel). VPN Gate keeps connection logs: this hides your traffic from
 * your internet provider; it is not anonymity.
 */
import { readFileSync, writeFileSync, existsSync, realpathSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const watch = process.argv.includes('--watch');
const out = args[0] ?? 'custom.ovpn';
const country = (args[1] ?? process.env.VPN_SERVER_COUNTRY_CODE ?? '').toUpperCase();

/**
 * The relay list. VPN Gate's API is slow and drops connections now and then ("fetch failed"); one failure
 * used to cost a whole minute while the tunnel sat on a dead relay, and several in a row left it there.
 */
async function relayList() {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('http://www.vpngate.net/api/iphone/', { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`VPN Gate answered ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err;
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  const cause = last?.cause?.code ?? last?.cause?.message;
  throw new Error(`VPN Gate unreachable (${last?.message ?? last}${cause ? `: ${cause}` : ''})`);
}

async function pick(avoid = new Set()) {
  const rows = (await relayList()).split('\n').filter(l => l && !l.startsWith('*') && !l.startsWith('#'));
  const servers = rows.map(line => {
    const c = line.split(',');
    return { host: c[0], ip: c[1], score: Number(c[2]), ping: Number(c[3]), country: c[6], config: c[14] ? Buffer.from(c[14].trim(), 'base64').toString('utf8') : '' };
  }).filter(s => s.config.includes('remote ') && Number.isFinite(s.score) && s.ping > 0 && !avoid.has(s.ip) && (!country || s.country === country));
  // Prefer TCP (works through more networks), then the best score.
  const tcp = s => (/^proto tcp/m.test(s.config) ? 1 : 0);
  servers.sort((a, b) => tcp(b) - tcp(a) || b.score - a.score);
  for (const s of servers.slice(0, 15)) {
    const { host, port } = remoteOf(s.config);
    if (await answers(host, port, protoOf(s.config))) return s;
  }
  throw new Error('VPN Gate has no reachable relay right now');
}

const remoteOf = config => {
  const m = /^remote\s+(\S+)\s+(\d+)/m.exec(config) ?? [];
  return { host: m[1] ?? '', port: Number(m[2] ?? 0) };
};
/**
 * The first packet of every OpenVPN connection (a "hard reset") and the reply a
 * working server gives. A relay that only accepts the connection and then drops
 * it, which volunteer servers do when overloaded, fails this and is replaced.
 */
export function helloPacket(tcp) {
  const body = Buffer.concat([Buffer.from([0x38]), randomBytes(8), Buffer.from([0, 0, 0, 0, 0])]);
  return tcp ? Buffer.concat([Buffer.from([0, body.length]), body]) : body;
}
export const isServerHello = (data, tcp) => data.length > (tcp ? 2 : 0) && (data[tcp ? 2 : 0] >> 3) === 8;

export const answers = (host, port, proto = 'tcp') => new Promise(ok => {
  if (!host || !port) return ok(false);
  if (proto === 'udp') {
    const socket = dgram.createSocket('udp4');
    const done = value => { clearTimeout(timer); try { socket.close(); } catch { /* already closed */ } ok(value); };
    const timer = setTimeout(() => done(false), 5000);
    socket.on('message', data => done(isServerHello(data, false)));
    socket.on('error', () => done(false));
    socket.send(helloPacket(false), port, host, err => { if (err) done(false); });
    return;
  }
  let settled = false;
  const finish = value => { if (settled) return; settled = true; socket.destroy(); ok(value); };
  const socket = net.connect({ host, port, timeout: 6000 }, () => socket.write(helloPacket(true)));
  socket.on('data', data => finish(isServerHello(data, true)));
  socket.on('error', () => finish(false));
  socket.on('close', () => finish(false));
  socket.on('timeout', () => finish(false));
});

const protoOf = config => (/^proto\s+udp/m.test(config) ? 'udp' : 'tcp');

/**
 * A relay can answer the OpenVPN handshake above (one packet, direct, not through the tunnel) while
 * the tunnel it actually carries is too lossy or slow for real traffic - a volunteer server under
 * load degrades gradually, it doesn't just go dark. That looked like Prowlarr searches failing with
 * "proxy tunnel request ... 503" every so often while this watcher stayed silent, because it only
 * ever checked the handshake. This checks the one thing that actually matters: can a real request get
 * through gluetun's own proxy right now, the same path every search and download uses.
 */
// Real hostnames, not a bare IP: VPN Gate relays were confirmed live to time out on http://1.1.1.1/ while
// ordinary sites loaded fine through the same tunnel, so a raw-IP probe failed every relay and the watcher
// threw away working tunnels one after another. Any one answering is enough; a 5xx is gluetun's proxy
// saying it could not reach the site, so it does not count.
export const PROBE_URLS = ['http://example.com/', 'http://www.msftconnecttest.com/connecttest.txt', 'http://detectportal.firefox.com/success.txt'];

const probeOnce = (proxyHost, proxyPort, path, timeoutMs) => new Promise(ok => {
  const req = http.request({ host: proxyHost, port: proxyPort, path, method: 'GET', timeout: timeoutMs }, res => { res.resume(); ok((res.statusCode ?? 500) < 500); });
  req.on('error', () => ok(false));
  req.on('timeout', () => { req.destroy(); ok(false); });
  req.end();
});

export const proxyCarriesTraffic = async (proxyHost = 'gluetun', proxyPort = 8888, timeoutMs = 10000, urls = PROBE_URLS) => {
  for (const url of urls) if (await probeOnce(proxyHost, proxyPort, url, timeoutMs)) return true;
  return false;
};

// The last few relays used, so asking for "another" (a restart, or the Fix everything button) never lands on the
// one that just had no peers, and repeated requests walk through different relays.
const recentFile = `${out}.recent`;
const recentRelays = () => { try { return JSON.parse(readFileSync(recentFile, 'utf8')).filter(x => typeof x === 'string'); } catch { return []; } };

async function choose(avoid = new Set()) {
  const seen = recentRelays();
  let s;
  try { s = await pick(new Set([...avoid, ...seen])); } catch (err) { if (!seen.length) throw err; s = await pick(avoid); }
  try { writeFileSync(recentFile, JSON.stringify([s.ip, ...seen.filter(ip => ip !== s.ip)].slice(0, 8)), { mode: 0o600 }); } catch { /* the list is a nicety */ }
  writeFileSync(out, s.config.replace(/\r/g, '') + '\ndata-ciphers-fallback AES-128-CBC\n', { mode: 0o600 });
  console.log(`vpngate: chose ${s.host} (${s.country}, ${s.ip})`);
  return s.ip;
}

/**
 * A new relay written to the config file did nothing on its own: OpenVPN's soft restart (what gluetun does
 * when a relay refuses) reuses the address it already has in memory, so the tunnel kept retrying the dead
 * relay forever ("Preserving recently used remote address") and every Prowlarr search through it failed.
 * gluetun re-reads the file only when its VPN loop is stopped and started, which its control server does.
 * That server refuses unauthenticated calls, so this writes a key into gluetun's auth file on the shared
 * volume (read when gluetun starts, which is after this watcher is healthy) and uses it.
 */
const authFile = join(dirname(out), 'auth', 'config.toml');
export function controlAuthToml(key) {
  return `[[roles]]\nname = "vpngate-watcher"\nroutes = ["GET /v1/vpn/status", "PUT /v1/vpn/status"]\nauth = "apikey"\napikey = "${key}"\n`;
}
function controlKey() {
  try { const m = /apikey = "([0-9a-f]{32,})"/.exec(readFileSync(authFile, 'utf8')); if (m) return m[1]; } catch { /* not written yet */ }
  const key = randomBytes(24).toString('hex');
  try { mkdirSync(dirname(authFile), { recursive: true }); writeFileSync(authFile, controlAuthToml(key), { mode: 0o600 }); } catch { /* read-only: restarts just won't be possible */ }
  return key;
}
async function setTunnel(status, key) {
  const res = await fetch('http://gluetun:8000/v1/vpn/status', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: JSON.stringify({ status }), signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`gluetun control server answered ${res.status}`);
}
async function restartTunnel(key) {
  try {
    await setTunnel('stopped', key);
    await setTunnel('running', key);
    console.log('vpngate: tunnel restarted on the new relay');
  } catch (err) {
    console.log(`vpngate: could not restart the tunnel (${err instanceof Error ? err.message : err}); it picks the new relay up on its next restart`);
  }
}

async function main() {
const key = watch ? controlKey() : '';
let current = '';
if (!existsSync(out) || !watch) current = await choose();
else {
  // Every start of the watcher picks a fresh relay (a relay that answers can still have no peers, and restarting is
  // how a person, or the "Fix everything" button, asks for another). If VPN Gate cannot be reached, keep the old one.
  const before = remoteOf(readFileSync(out, 'utf8'));
  current = before.host;
  try {
    current = await choose(new Set([before.host]));
    // If gluetun is already up on the old relay (only this watcher restarted), move it over now.
    if (watch) await restartTunnel(key);
  } catch (err) { console.log(`vpngate: keeping ${before.host} (${err instanceof Error ? err.message : err})`); }
}
if (!watch) process.exit(0);

let misses = 0;
// A pick can take minutes (a slow relay list, then up to 15 handshakes): checks must not pile up on each other.
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const config = readFileSync(out, 'utf8');
    const { host, port } = remoteOf(config);
    const handshakeOk = await answers(host, port, protoOf(config));
    const trafficOk = handshakeOk && await proxyCarriesTraffic();
    if (handshakeOk && trafficOk) { misses = 0; return; }
    if (++misses < 2) return;
    console.log(`vpngate: relay ${host} ${handshakeOk ? 'handshake ok but no real traffic is getting through' : 'stopped answering'}, choosing another`);
    misses = 0;
    current = await choose(new Set([host, current]));
    await restartTunnel(key);
  } catch (err) {
    console.log(`vpngate: ${err instanceof Error ? err.message : err}`);
  } finally {
    busy = false;
  }
}, 60_000);
}

// Run only when started directly, not when a test imports the helpers.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
