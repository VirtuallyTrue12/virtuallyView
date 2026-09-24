#!/usr/bin/env node
/**
 * Picks a free public relay from VPN Gate (an academic project of the
 * University of Tsukuba; needs no account) and writes its OpenVPN config for
 * gluetun. Usage: node scripts/vpngate.mjs /gluetun/custom.ovpn [country code]
 *
 * These relays are run by volunteers and VPN Gate keeps connection logs. It
 * hides your traffic from your internet provider; it is not anonymity.
 */
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'custom.ovpn';
const country = (process.argv[3] ?? process.env.VPN_SERVER_COUNTRY_CODE ?? '').toUpperCase();
const res = await fetch('http://www.vpngate.net/api/iphone/', { signal: AbortSignal.timeout(60000) });
if (!res.ok) throw new Error(`VPN Gate answered ${res.status}`);
const rows = (await res.text()).split('\n').filter(l => l && !l.startsWith('*') && !l.startsWith('#'));
const servers = rows.map(line => {
  const c = line.split(',');
  return { host: c[0], ip: c[1], score: Number(c[2]), ping: Number(c[3]), country: c[6], config: c[14] ? Buffer.from(c[14].trim(), 'base64').toString('utf8') : '' };
}).filter(s => s.config.includes('remote ') && Number.isFinite(s.score) && s.ping > 0 && (!country || s.country === country));
// Prefer TCP on a common port (works through more networks), then the best score.
const tcp = s => /^proto tcp/m.test(s.config) ? 1 : 0;
servers.sort((a, b) => tcp(b) - tcp(a) || b.score - a.score);
const pick = servers[0];
if (!pick) throw new Error('VPN Gate has no usable relay right now');
const config = pick.config.replace(/\r/g, '') + '\ndata-ciphers-fallback AES-128-CBC\n';
writeFileSync(out, config, { mode: 0o600 });
console.log(`vpngate: chose ${pick.host} (${pick.country}, ${pick.ip}), ${servers.length} relays available`);
