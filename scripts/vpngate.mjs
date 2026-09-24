#!/usr/bin/env node
/**
 * Picks a free public relay from VPN Gate (an academic project of the
 * University of Tsukuba; needs no account) and writes its OpenVPN config for
 * gluetun.
 *
 *   node scripts/vpngate.mjs /gluetun/custom.ovpn [country code]          pick once
 *   node scripts/vpngate.mjs /gluetun/custom.ovpn [country code] --watch   keep it healthy
 *
 * Relays are run by volunteers and come and go, so --watch checks the chosen
 * relay every minute and, when it stops answering, writes a fresh one (gluetun
 * re-reads the file when it restarts the tunnel). VPN Gate keeps connection
 * logs: this hides your traffic from your internet provider; it is not anonymity.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import net from 'node:net';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const watch = process.argv.includes('--watch');
const out = args[0] ?? 'custom.ovpn';
const country = (args[1] ?? process.env.VPN_SERVER_COUNTRY_CODE ?? '').toUpperCase();

async function pick(avoid = new Set()) {
  const res = await fetch('http://www.vpngate.net/api/iphone/', { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`VPN Gate answered ${res.status}`);
  const rows = (await res.text()).split('\n').filter(l => l && !l.startsWith('*') && !l.startsWith('#'));
  const servers = rows.map(line => {
    const c = line.split(',');
    return { host: c[0], ip: c[1], score: Number(c[2]), ping: Number(c[3]), country: c[6], config: c[14] ? Buffer.from(c[14].trim(), 'base64').toString('utf8') : '' };
  }).filter(s => s.config.includes('remote ') && Number.isFinite(s.score) && s.ping > 0 && !avoid.has(s.ip) && (!country || s.country === country));
  // Prefer TCP (works through more networks), then the best score.
  const tcp = s => (/^proto tcp/m.test(s.config) ? 1 : 0);
  servers.sort((a, b) => tcp(b) - tcp(a) || b.score - a.score);
  for (const s of servers.slice(0, 15)) {
    const { host, port } = remoteOf(s.config);
    if (await answers(host, port)) return s;
  }
  throw new Error('VPN Gate has no reachable relay right now');
}

const remoteOf = config => {
  const m = /^remote\s+(\S+)\s+(\d+)/m.exec(config) ?? [];
  return { host: m[1] ?? '', port: Number(m[2] ?? 0) };
};
const answers = (host, port) => new Promise(ok => {
  if (!host || !port) return ok(false);
  const socket = net.connect({ host, port, timeout: 4000 }, () => { socket.destroy(); ok(true); });
  socket.on('error', () => ok(false));
  socket.on('timeout', () => { socket.destroy(); ok(false); });
});

async function choose(avoid) {
  const s = await pick(avoid);
  writeFileSync(out, s.config.replace(/\r/g, '') + '\ndata-ciphers-fallback AES-128-CBC\n', { mode: 0o600 });
  console.log(`vpngate: chose ${s.host} (${s.country}, ${s.ip})`);
  return s.ip;
}

let current = '';
if (!existsSync(out) || !watch) current = await choose();
else current = remoteOf(readFileSync(out, 'utf8')).host;
if (!watch) process.exit(0);

let misses = 0;
setInterval(async () => {
  try {
    const { host, port } = remoteOf(readFileSync(out, 'utf8'));
    if (await answers(host, port)) { misses = 0; return; }
    if (++misses < 2) return;
    console.log(`vpngate: relay ${host} stopped answering, choosing another`);
    misses = 0;
    await choose(new Set([host, current]));
  } catch (err) {
    console.log(`vpngate: ${err instanceof Error ? err.message : err}`);
  }
}, 60_000);
