import tls from 'node:tls';

// Google Cast (Chromecast, Google TV, Android TV such as Sony Bravia): the TV opens Google's own media player
// and fetches the video from this server; nothing goes through Google's cloud. The protocol is small: framed
// protobuf messages over TLS on port 8009, each carrying a JSON payload.

const MEDIA_APP = 'CC1AD845'; // Google's Default Media Receiver
const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media'
};

const varint = (n: number): Buffer => {
  const out: number[] = [];
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
  out.push(n);
  return Buffer.from(out);
};
const field = (no: number, value: string | number): Buffer => typeof value === 'number'
  ? Buffer.concat([varint(no << 3), varint(value)])
  : Buffer.concat([varint((no << 3) | 2), varint(Buffer.byteLength(value)), Buffer.from(value)]);

/** One CastMessage: protocol version, source, destination, namespace, payload type (string), payload. */
export function encodeMessage(source: string, destination: string, namespace: string, payload: object): Buffer {
  const body = Buffer.concat([field(1, 0), field(2, source), field(3, destination), field(4, namespace), field(5, 0), field(6, JSON.stringify(payload))]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

/** The namespace and JSON payload of one CastMessage body (without its length prefix). */
export function decodeMessage(body: Buffer): { namespace: string; data: Record<string, unknown> } {
  let i = 0;
  const read = () => { let n = 0, shift = 0, b: number; do { b = body[i++]!; n += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80); return n; };
  const strings: Record<number, string> = {};
  while (i < body.length) {
    const key = read();
    if ((key & 7) === 0) { read(); continue; }
    const len = read();
    strings[key >> 3] = body.subarray(i, i + len).toString();
    i += len;
  }
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(strings[6] ?? '{}') as Record<string, unknown>; } catch { /* binary payload */ }
  return { namespace: strings[4] ?? '', data };
}

type Reply = { namespace: string; data: Record<string, unknown> };

/** A short session with the TV: send, and wait for the reply that matches. */
function session<T>(host: string, run: (send: (to: string, ns: string, payload: object) => void, wait: (match: (r: Reply) => boolean) => Promise<Reply>) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = tls.connect({ host, port: 8009, rejectUnauthorized: false, timeout: 20000 });
    let buffer = Buffer.alloc(0);
    const waiters: { match: (r: Reply) => boolean; done: (r: Reply) => void }[] = [];
    const send = (to: string, ns: string, payload: object) => socket.write(encodeMessage('sender-vv', to, ns, payload));
    const fail = (err: Error) => { socket.destroy(); reject(err); };
    socket.on('timeout', () => fail(new Error('The TV stopped answering.')));
    socket.on('error', () => fail(new Error('Could not reach the TV. Is it switched on?')));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
        const reply = decodeMessage(buffer.subarray(4, 4 + buffer.readUInt32BE(0)));
        buffer = buffer.subarray(4 + buffer.readUInt32BE(0));
        if (reply.namespace === NS.heartbeat && reply.data.type === 'PING') { send('receiver-0', NS.heartbeat, { type: 'PONG' }); continue; }
        const at = waiters.findIndex(w => w.match(reply));
        if (at >= 0) waiters.splice(at, 1)[0]!.done(reply);
      }
    });
    socket.once('secureConnect', () => {
      send('receiver-0', NS.connection, { type: 'CONNECT' });
      const wait = (match: (r: Reply) => boolean) => new Promise<Reply>(done => { waiters.push({ match, done }); });
      run(send, wait).then(value => { socket.end(); resolve(value); }, fail);
    });
  });
}

interface App { appId?: string; sessionId?: string; transportId?: string }
const appsOf = (r: Reply) => ((r.data.status as { applications?: App[] } | undefined)?.applications ?? []);

export async function castPlay(host: string, url: string, title: string): Promise<void> {
  const contentType = /\.m3u8(\?|$)/.test(url) ? 'application/x-mpegURL' : /\/music\//.test(url) ? 'audio/mpeg' : 'video/mp4';
  await session(host, async (send, wait) => {
    send('receiver-0', NS.receiver, { type: 'LAUNCH', appId: MEDIA_APP, requestId: 1 });
    const status = await wait(r => r.namespace === NS.receiver && appsOf(r).some(a => a.appId === MEDIA_APP && a.transportId));
    const app = appsOf(status).find(a => a.appId === MEDIA_APP)!;
    send(app.transportId!, NS.connection, { type: 'CONNECT' });
    send(app.transportId!, NS.media, {
      type: 'LOAD', requestId: 2, autoplay: true,
      media: { contentId: url, contentType, streamType: 'BUFFERED', metadata: { metadataType: 0, title } }
    });
    const result = await wait(r => r.namespace === NS.media && ['MEDIA_STATUS', 'LOAD_FAILED', 'LOAD_CANCELLED', 'INVALID_REQUEST'].includes(String(r.data.type)) && (r.data.requestId === 2 || r.data.type !== 'MEDIA_STATUS'));
    if (result.data.type !== 'MEDIA_STATUS') throw new Error('The TV could not play this video.');
  });
}

export async function castStop(host: string): Promise<void> {
  await session(host, async (send, wait) => {
    send('receiver-0', NS.receiver, { type: 'GET_STATUS', requestId: 1 });
    const status = await wait(r => r.namespace === NS.receiver && r.data.type === 'RECEIVER_STATUS');
    const app = appsOf(status).find(a => a.appId === MEDIA_APP);
    if (app?.sessionId) send('receiver-0', NS.receiver, { type: 'STOP', sessionId: app.sessionId, requestId: 2 });
  });
}
