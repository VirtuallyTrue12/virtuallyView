import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProfileAvatar } from './api';
import { clockOffset, expectedPosition, type ClockSample, type SharedState } from './partySync';

export type PartyState = SharedState;
export interface PartyMember { id: string; name: string; avatar: ProfileAvatar | null; host: boolean }
export interface PartyMessage { id: number; name: string; text: string; at: number }
export interface PartyReaction { key: number; name: string; emoji: string }

const post = (url: string, body: unknown): Promise<Response> =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Ping the server a few times; the quickest round trip gives the best estimate of its clock. */
async function measureClock(): Promise<number> {
  const samples: ClockSample[] = [];
  for (let i = 0; i < 5; i++) {
    const sent = Date.now();
    try {
      const { now } = (await (await fetch('/api/party-clock')).json()) as { now: number };
      samples.push({ sent, received: Date.now(), server: now });
    } catch { /* a missed ping just means fewer samples */ }
  }
  return clockOffset(samples);
}

/**
 * Join a watch-together room. Everyone's play, pause, seek and speed reach everyone; `expected()` says where
 * the video should be right now by the shared clock; chat, reactions and the member list come along too.
 */
export function useWatchParty(code: string | null) {
  const client = useMemo(() => Math.random().toString(36).slice(2, 10), []);
  const [remote, setRemote] = useState<PartyState | null>(null);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [you, setYou] = useState('');
  const [waiting, setWaiting] = useState<string[]>([]);
  const [chat, setChat] = useState<PartyMessage[]>([]);
  const [reactions, setReactions] = useState<PartyReaction[]>([]);
  const [ended, setEnded] = useState(false);
  const offset = useRef(0);
  const latest = useRef<PartyState | null>(null);
  const reactionKey = useRef(0);
  const url = code ? `/api/watch-party/${encodeURIComponent(code)}` : '';

  useEffect(() => {
    if (!code) return;
    let source: EventSource | undefined;
    let cancelled = false;
    let recheck: number | undefined;
    void measureClock().then(o => {
      if (cancelled) return;
      offset.current = o;
      recheck = window.setInterval(() => void measureClock().then(next => { offset.current = next; }), 120_000);
      source = new EventSource(`${url}/events?client=${client}`);
      source.addEventListener('hello', e => setYou((JSON.parse((e as MessageEvent).data) as { you: string }).you));
      source.addEventListener('state', e => {
        const state = JSON.parse((e as MessageEvent).data) as PartyState;
        latest.current = state;
        setWaiting(state.waiting);
        // The first message is the room's current state; a new joiner adopts it once, and only if something has happened.
        if (state.seq > 0 && state.from !== client) setRemote(state);
      });
      source.addEventListener('members', e => setMembers((JSON.parse((e as MessageEvent).data) as { members: PartyMember[] }).members));
      source.addEventListener('chat', e => { const m = JSON.parse((e as MessageEvent).data) as PartyMessage; setChat(list => (list.some(x => x.id === m.id) ? list : [...list, m].slice(-100))); });
      source.addEventListener('reaction', e => {
        const r = { ...(JSON.parse((e as MessageEvent).data) as Omit<PartyReaction, 'key'>), key: ++reactionKey.current };
        setReactions(list => [...list, r].slice(-12));
        window.setTimeout(() => setReactions(list => list.filter(x => x.key !== r.key)), 3200);
      });
      source.addEventListener('ended', () => { setEnded(true); source?.close(); });
      source.onerror = () => { if (source?.readyState === EventSource.CLOSED) setEnded(true); };
    });
    return () => { cancelled = true; window.clearInterval(recheck); source?.close(); };
  }, [code, client, url]);

  const onLocal = useCallback((playing: boolean, position: number, rate = 1) => {
    if (!code) return;
    latest.current = { playing, position, rate, seq: (latest.current?.seq ?? 0) + 1, from: client, at: Date.now() + offset.current, waiting: latest.current?.waiting ?? [] };
    void post(`${url}/state`, { client, playing, position, rate }).catch(() => undefined);
  }, [code, client, url]);

  const onBuffering = useCallback((buffering: boolean) => {
    if (code) void post(`${url}/buffering`, { client, buffering }).catch(() => undefined);
  }, [code, client, url]);

  /** Where the video should be right now, or null when nothing has happened in the room yet. */
  const expected = useCallback((): number | null => (latest.current && latest.current.seq > 0 ? expectedPosition(latest.current, Date.now() + offset.current) : null), []);

  const say = useCallback((body: { text?: string; reaction?: string }) => post(`${url}/chat`, { client, ...body }).then(r => r.ok).catch(() => false), [client, url]);
  const giveHost = useCallback((to: string) => post(`${url}/host`, { to }).then(r => r.ok).catch(() => false), [url]);

  return {
    remote, members, you, host: members.find(m => m.host)?.id === you, waitingFor: waiting.filter(n => n !== members.find(m => m.id === you)?.name),
    chat, reactions, ended, onLocal, onBuffering, expected, say, giveHost
  };
}

export type Party = ReturnType<typeof useWatchParty>;
