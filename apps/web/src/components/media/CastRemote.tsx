import { useEffect, useRef, useState } from 'react';
import { toast } from '../ui/Toast';

/**
 * The remote for a video playing on a TV: follows the TV's own clock (every 2 s while visible), with play/pause,
 * 10 s skips and a seek bar that sends the TV to the new spot. Seeking on the TV's own remote shows up here too.
 */
interface Status { state: 'PLAYING' | 'PAUSED' | 'BUFFERING' | 'IDLE'; position: number; duration: number }

const fmt = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const post = (url: string, body: object) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function CastRemote({ device, duration, onPosition, onEnded, onWatchHere, onStop }: {
  device: { id: string; name: string };
  /** Length from this page, used until the TV reports its own. */
  duration?: number | null;
  /** The TV's position, so this page is in the same place if the viewer takes it back. */
  onPosition: (seconds: number) => void;
  /** The session ended on the TV (played to the end, or stopped there). */
  onEnded: () => void;
  onWatchHere: () => void;
  onStop: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const failures = useRef(0);
  const live = useRef({ onPosition, onEnded });
  live.current = { onPosition, onEnded };

  useEffect(() => {
    let alive = true;
    const read = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/cast/status?device=${encodeURIComponent(device.id)}`);
        if (!alive) return;
        // The session is over: it played to the end on the TV, or was stopped from the TV's own remote.
        if (res.status === 404) { live.current.onEnded(); return; }
        if (!res.ok) throw new Error();
        const next = (await res.json()) as Status;
        failures.current = 0;
        setStatus(next);
        if (next.position > 0) live.current.onPosition(next.position);
      } catch {
        // A TV loading a video answers nothing for a while: only say so when it lasts.
        if (++failures.current === 8) toast(`Lost touch with ${device.name}. It may be switched off.`, { tone: 'err' });
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [device.id, device.name]);

  const control = async (action: 'play' | 'pause' | 'seek', position?: number) => {
    setBusy(true);
    if (status && position !== undefined) setStatus({ ...status, position });
    try {
      const res = await post('/api/cast/control', { device: device.id, action, position });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'The TV did not respond.');
      if (action !== 'seek' && status) setStatus({ ...status, state: action === 'play' ? 'PLAYING' : 'PAUSED' });
    } catch (err) {
      toast((err as Error).message, { tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const length = status?.duration || duration || 0;
  const at = drag ?? status?.position ?? 0;
  const playing = status?.state === 'PLAYING' || status?.state === 'BUFFERING';
  const label = !status ? 'Connecting…' : status.state === 'BUFFERING' ? 'Loading on the TV…' : status.state === 'PAUSED' ? 'Paused' : status.state === 'IDLE' ? 'Starting…' : 'Playing';

  return (
    <div className="cast-remote">
      <p className="cast-remote-title">Playing on {device.name}</p>
      <p className="cast-remote-state">{label}</p>
      <div className="cast-remote-bar">
        <span>{fmt(at)}</span>
        <input
          type="range" min={0} max={Math.max(1, Math.floor(length))} step={1} value={Math.floor(at)} disabled={!length}
          aria-label="Position on the TV"
          onChange={e => setDrag(Number(e.target.value))}
          onPointerUp={() => { if (drag !== null) { void control('seek', drag); setDrag(null); } }}
          onKeyUp={e => { if (drag !== null && /Arrow|Home|End|Page/.test(e.key)) { void control('seek', drag); setDrag(null); } }}
        />
        <span>{fmt(length)}</span>
      </div>
      <div className="cast-remote-buttons">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !status} onClick={() => void control('seek', Math.max(0, at - 10))} aria-label="Back 10 seconds">−10 s</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !status} onClick={() => void control(playing ? 'pause' : 'play')}>{playing ? 'Pause' : 'Play'}</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !status} onClick={() => void control('seek', Math.min(length || at + 10, at + 10))} aria-label="Forward 10 seconds">+10 s</button>
      </div>
      <div className="cast-remote-buttons">
        <button type="button" className="btn btn-primary btn-sm" onClick={onWatchHere}>Watch here instead</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onStop}>Stop on TV</button>
      </div>
    </div>
  );
}
