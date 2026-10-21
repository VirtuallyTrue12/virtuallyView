#!/usr/bin/env node
/**
 * Tells the dashboard which addresses this computer has, so it can show people the one to open on a phone or TV.
 *
 * The dashboard runs in a container and only ever sees its own container address (10.89.x.x), which no other
 * device can reach. This runs on the host's network (network_mode: host in docker-compose.yml), reads the real
 * interfaces, and writes them to a small JSON file on a volume the dashboard mounts read-only. It refreshes every
 * minute, because a laptop's Wi-Fi address changes when it moves between networks.
 *
 *   node scripts/host-addresses.mjs /host-net/addresses.json
 *
 * Nothing is listened on; it only writes the file.
 */
import { networkInterfaces } from 'node:os';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

/** Container and VM bridges: real addresses, but not ones another device on the network can reach. */
const VIRTUAL = /^(podman|docker|br-|veth|cni|virbr|vmnet|vboxnet|flannel|cali|lxc|lxd|kube|tun|tap|utun|zt)/i;

export function kindOf(name, address) {
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) || /^tailscale/i.test(name)) return 'tailscale';
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) return 'lan';
  return null;
}

/** The addresses worth showing, home network first. Pure so it can be tested. */
export function hostAddresses(interfaces = networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const kind = kindOf(name, item.address);
      if (kind) out.push({ interface: name, address: item.address, kind });
    }
  }
  return out.sort((a, b) => (a.kind === 'lan' ? 0 : 1) - (b.kind === 'lan' ? 0 : 1));
}

function write(file) {
  const body = JSON.stringify({ updatedAt: new Date().toISOString(), addresses: hostAddresses() });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, body);
  renameSync(`${file}.tmp`, file);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const file = process.argv[2] ?? '/host-net/addresses.json';
  const tick = () => { try { write(file); } catch (err) { console.log(`host-addresses: ${err instanceof Error ? err.message : err}`); } };
  tick();
  setInterval(tick, 60_000);
}
