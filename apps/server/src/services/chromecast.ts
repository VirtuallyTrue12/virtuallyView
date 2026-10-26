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

/**
 * A short session with the TV: send, and wait for the reply that matches. `limitMs` caps the whole exchange: a TV
 * that is still loading a video answers nothing at all until it is done (half a minute is normal).
 */
function session<T>(host: string, run: (send: (to: string, ns: string, payload: object) => void, wait: (match: (r: Reply) => boolean) => Promise<Reply>) => Promise<T>, limitMs = 45_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = tls.connect({ host, port: 8009, rejectUnauthorized: false, timeout: 20000 });
    let buffer = Buffer.alloc(0);
    const waiters: { match: (r: Reply) => boolean; done: (r: Reply) => void }[] = [];
    // Each connection is its own sender: the TV routes replies by this name, so a reused one can land on a closed link.
    const me = `sender-vv-${Math.random().toString(36).slice(2, 10)}`;
    const send = (to: string, ns: string, payload: object) => socket.write(encodeMessage(me, to, ns, payload));
    const limit = setTimeout(() => fail(new Error('The TV did not answer.')), limitMs);
    const fail = (err: Error) => { clearTimeout(limit); socket.destroy(); reject(err); };
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
      run(send, wait).then(value => { clearTimeout(limit); socket.end(); resolve(value); }, fail);
    });
  });
}

interface App { appId?: string; sessionId?: string; transportId?: string }
const appsOf = (r: Reply) => ((r.data.status as { applications?: App[] } | undefined)?.applications ?? []);

/** What the TV is currently doing with the media app. */
export interface CastStatus {
  state: 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'IDLE';
  currentTime: number;
  duration?: number;
  idleReason?: string;
}

/** Ask the TV what it is playing right now. Returns null if no media is loaded. */
export async function castStatus(host: string): Promise<CastStatus | null> {
  try {
    return await session(host, async (send, wait) => {
      send('receiver-0', NS.receiver, { type: 'GET_STATUS', requestId: 1 });
      const recv = await wait(r => r.namespace === NS.receiver && r.data.type === 'RECEIVER_STATUS');
      const app = appsOf(recv).find(a => a.appId === MEDIA_APP && a.transportId);
      if (!app) return null;
      send(app.transportId!, NS.connection, { type: 'CONNECT' });
      send(app.transportId!, NS.media, { type: 'GET_STATUS', requestId: 2 });
      const ms = await wait(r => r.namespace === NS.media && r.data.type === 'MEDIA_STATUS');
      const statuses = (ms.data.status as Array<Record<string, unknown>> | undefined) ?? [];
      const s = statuses[0];
      if (!s) return null;
      const state = String(s.playerState ?? 'IDLE') as CastStatus['state'];
      const currentTime = Number(s.currentTime ?? 0);
      const duration = typeof s.media === 'object' && s.media !== null ? Number((s.media as Record<string, unknown>).duration ?? 0) || undefined : undefined;
      const idleReason = typeof s.idleReason === 'string' ? s.idleReason : undefined;
      return { state, currentTime, duration, idleReason };
    }, 8000);
  } catch {
    return null;
  }
}

/** Send a play, pause or seek command to the TV. */
export async function castControl(host: string, action: 'PLAY' | 'PAUSE' | 'SEEK', time?: number): Promise<void> {
  await session(host, async (send, wait) => {
    send('receiver-0', NS.receiver, { type: 'GET_STATUS', requestId: 1 });
    const recv = await wait(r => r.namespace === NS.receiver && r.data.type === 'RECEIVER_STATUS');
    const app = appsOf(recv).find(a => a.appId === MEDIA_APP && a.transportId);
    if (!app) throw new Error('The TV is not playing anything.');
    send(app.transportId!, NS.connection, { type: 'CONNECT' });
    send(app.transportId!, NS.media, { type: 'GET_STATUS', requestId: 2 });
    const ms = await wait(r => r.namespace === NS.media && r.data.type === 'MEDIA_STATUS');
    const statuses = (ms.data.status as Array<Record<string, unknown>> | undefined) ?? [];
    const mediaSessionId = statuses[0]?.mediaSessionId as number | undefined;
    if (!mediaSessionId) throw new Error('No active media session on the TV.');
    const payload: Record<string, unknown> = { type: action, mediaSessionId, requestId: 3 };
    if (action === 'SEEK' && time !== undefined) payload.currentTime = time;
    send(app.transportId!, NS.media, payload);
    await wait(r => r.namespace === NS.media && r.data.type === 'MEDIA_STATUS' && r.data.requestId === 3);
  }, 10_000);
}

export interface CastPlayOptions {
  /** Metadata for the TV's now-playing overlay. */
  poster?: string;
  metadataType?: 0 | 1 | 2; // 0=generic, 1=movie, 2=tv episode
  seriesTitle?: string;
  season?: number;
  episode?: number;
  /** Subtitle track (WebVTT URL). */
  subtitleUrl?: string;
  subtitleLabel?: string;
  subtitleLang?: string;
}

export async function castPlay(host: string, url: string, title: string, opts: CastPlayOptions = {}): Promise<void> {
  const contentType = /\.m3u8(\?|$)/.test(url) ? 'application/x-mpegURL' : /\/music\//.test(url) ? 'audio/mpeg' : 'video/mp4';
  await session(host, async (send, wait) => {
    send('receiver-0', NS.receiver, { type: 'LAUNCH', appId: MEDIA_APP, requestId: 1 });
    const status = await wait(r => r.namespace === NS.receiver && appsOf(r).some(a => a.appId === MEDIA_APP && a.transportId));
    const app = appsOf(status).find(a => a.appId === MEDIA_APP)!;
    send(app.transportId!, NS.connection, { type: 'CONNECT' });

    const metadata: Record<string, unknown> = { metadataType: opts.metadataType ?? 0, title };
    if (opts.poster) metadata.images = [{ url: opts.poster }];
    if (opts.metadataType === 2 && opts.seriesTitle) {
      metadata.seriesTitle = opts.seriesTitle;
      if (opts.season !== undefined) metadata.season = opts.season;
      if (opts.episode !== undefined) metadata.episode = opts.episode;
    }

    const tracks: Array<Record<string, unknown>> = [];
    const activeTrackIds: number[] = [];
    if (opts.subtitleUrl && opts.subtitleUrl.includes('.vtt')) {
      tracks.push({ trackId: 1, type: 'TEXT', trackContentId: opts.subtitleUrl, trackContentType: 'text/vtt', subtype: 'SUBTITLES', name: opts.subtitleLabel ?? 'Subtitles', language: opts.subtitleLang ?? 'en' });
      activeTrackIds.push(1);
    }

    const mediaPayload: Record<string, unknown> = {
      type: 'LOAD', requestId: 2, autoplay: true,
      media: { contentId: url, contentType, streamType: 'BUFFERED', metadata, ...(tracks.length ? { tracks } : {}) },
      ...(activeTrackIds.length ? { activeTrackIds } : {})
    };

    send(app.transportId!, NS.media, mediaPayload);
    // The first status after LOAD is often a bare IDLE, with the failure only after it: wait for real playback
    // (or a failure), not just any status.
    const started = (r: Reply) => ((r.data.status as Array<{ playerState?: string; idleReason?: string }> | undefined) ?? [])[0];
    const result = await wait(r => r.namespace === NS.media && (
      ['LOAD_FAILED', 'LOAD_CANCELLED', 'INVALID_REQUEST'].includes(String(r.data.type)) ||
      (r.data.type === 'MEDIA_STATUS' && (['PLAYING', 'BUFFERING', 'PAUSED'].includes(String(started(r)?.playerState)) || started(r)?.idleReason === 'ERROR'))
    ));
    if (result.data.type !== 'MEDIA_STATUS' || started(result)?.idleReason === 'ERROR') throw new Error('The TV could not play this video.');
  });
}

/** Stop the TV; returns the position the TV had reached (0 if the state could not be read). */
export async function castStop(host: string): Promise<number> {
  let lastPosition = 0;
  await session(host, async (send, wait) => {
    send('receiver-0', NS.receiver, { type: 'GET_STATUS', requestId: 1 });
    const status = await wait(r => r.namespace === NS.receiver && r.data.type === 'RECEIVER_STATUS');
    const app = appsOf(status).find(a => a.appId === MEDIA_APP);
    if (!app) return;
    // Read the media position before stopping.
    if (app.transportId) {
      send(app.transportId, NS.connection, { type: 'CONNECT' });
      send(app.transportId, NS.media, { type: 'GET_STATUS', requestId: 2 });
      try {
        const ms = await Promise.race([
          wait(r => r.namespace === NS.media && r.data.type === 'MEDIA_STATUS'),
          new Promise<Reply>(resolve => setTimeout(() => resolve({ namespace: '', data: {} }), 3000))
        ]);
        const statuses = (ms.data.status as Array<Record<string, unknown>> | undefined) ?? [];
        lastPosition = Number(statuses[0]?.currentTime ?? 0);
      } catch { /* best effort */ }
    }
    if (app.sessionId) send('receiver-0', NS.receiver, { type: 'STOP', sessionId: app.sessionId, requestId: 3 });
  }, 10_000);
  return lastPosition;
}
