import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import { createSocket } from 'node:dgram';
import { answers, helloPacket, isServerHello } from '../../scripts/vpngate.mjs';

const listen = (handler: (socket: import('node:net').Socket) => void) => new Promise<{ server: Server; port: number }>(res => {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1', () => res({ server, port: (server.address() as { port: number }).port }));
});

describe('VPN relay liveness', () => {
  it('sends a valid OpenVPN hard reset and recognises a server reply', () => {
    const tcp = helloPacket(true);
    expect(tcp.readUInt16BE(0)).toBe(tcp.length - 2);
    expect(tcp[2]! >> 3).toBe(7); // P_CONTROL_HARD_RESET_CLIENT_V2
    const udp = helloPacket(false);
    expect(udp[0]! >> 3).toBe(7);
    expect(isServerHello(Buffer.from([0, 14, 0x40, 1, 2, 3]), true)).toBe(true);
    expect(isServerHello(Buffer.from([0x40, 1, 2]), false)).toBe(true);
    expect(isServerHello(Buffer.from([0, 14, 0x38, 1]), true)).toBe(false);
    expect(isServerHello(Buffer.alloc(0), true)).toBe(false);
  });

  it('accepts a relay that answers the handshake', async () => {
    const { server, port } = await listen(socket => socket.on('data', () => socket.write(Buffer.from([0, 14, 0x40, 9, 9, 9, 9, 9, 9, 9, 9, 0, 0, 0, 0, 0]))));
    expect(await answers('127.0.0.1', port, 'tcp')).toBe(true);
    server.close();
  });

  it('rejects a relay that accepts the connection and then drops it (the case that broke the tunnel)', async () => {
    const { server, port } = await listen(socket => socket.on('data', () => socket.destroy()));
    expect(await answers('127.0.0.1', port, 'tcp')).toBe(false);
    server.close();
  });

  it('rejects a port where nothing listens, and a server that says nothing', async () => {
    const { server, port } = await listen(() => undefined);
    expect(await answers('127.0.0.1', port, 'tcp')).toBe(false); // silent: times out
    server.close();
    expect(await answers('127.0.0.1', port, 'tcp')).toBe(false); // closed
  }, 15_000);

  it('probes UDP relays too', async () => {
    const udp = createSocket('udp4');
    await new Promise<void>(r => udp.bind(0, '127.0.0.1', () => r()));
    udp.on('message', (_m, rinfo) => udp.send(Buffer.from([0x40, 1, 2, 3]), rinfo.port, rinfo.address));
    expect(await answers('127.0.0.1', udp.address().port, 'udp')).toBe(true);
    udp.close();
  });
});
