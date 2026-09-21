import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface PartyState { playing: boolean; position: number; seq: number; from: string }

/**
 * Join a watch-together room: everyone's play, pause and seek reach everyone.
 * Returns the latest remote state to apply, and a sender for local changes.
 */
export function useWatchParty(code: string | null) {
  const client = useMemo(() => Math.random().toString(36).slice(2, 10), []);
  const [remote, setRemote] = useState<PartyState | null>(null);
  const [watching, setWatching] = useState(0);
  const [ended, setEnded] = useState(false);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!code) return;
    const source = new EventSource(`/api/watch-party/${encodeURIComponent(code)}/events?client=${client}`);
    source.addEventListener('state', event => {
      const state = JSON.parse((event as MessageEvent).data) as PartyState;
      // The first message is the room's current state; a new joiner adopts it once, and only if something has happened.
      if (state.seq > 0 && state.from !== client) setRemote(state);
    });
    source.addEventListener('watching', event => setWatching((JSON.parse((event as MessageEvent).data) as { count: number }).count));
    source.onerror = () => { if (source.readyState === EventSource.CLOSED) setEnded(true); };
    return () => source.close();
  }, [code, client]);

  const onLocal = useCallback((playing: boolean, position: number) => {
    if (!code) return;
    const now = Date.now();
    if (now - lastSent.current < 250) return;
    lastSent.current = now;
    void fetch(`/api/watch-party/${encodeURIComponent(code)}/state`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client, playing, position })
    }).catch(() => undefined);
  }, [code, client]);

  return { remote, watching, ended, onLocal };
}
