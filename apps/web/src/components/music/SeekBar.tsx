import { useCallback, useEffect, useRef, useState } from 'react';

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

interface SeekBarProps {
  /** The exact position right now. Read every frame while playing, so the bar glides instead of ticking. */
  getTime: () => number;
  duration: number;
  /** How far the file has loaded, in seconds. */
  buffered: number;
  playing: boolean;
  onSeek: (seconds: number) => void;
  label?: string;
  /** Elapsed and remaining time beside the bar, or none. */
  times?: 'sides' | 'none';
  size?: 'regular' | 'slim';
}

/**
 * A custom progress bar for music: drag or click to seek, hover to preview the
 * time, arrow keys for fine control. It draws with transforms only and paints
 * from the audio clock every frame rather than waiting for React, which is
 * what makes it smooth.
 */
export function SeekBar({ getTime, duration, buffered, playing, onSeek, label = 'Seek', times = 'sides', size = 'regular' }: SeekBarProps) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const elapsedEl = useRef<HTMLSpanElement>(null);
  const remainingEl = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const scrub = useRef<number | null>(null);
  const shownSecond = useRef(-1);
  const [dragging, setDragging] = useState(false);

  const paint = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const t = scrub.current ?? getTime();
    const p = duration > 0 ? Math.max(0, Math.min(1, t / duration)) : 0;
    el.style.setProperty('--p', String(p));
    const second = Math.floor(t);
    if (second !== shownSecond.current) {
      shownSecond.current = second;
      if (elapsedEl.current) elapsedEl.current.textContent = formatClock(t);
      if (remainingEl.current) remainingEl.current.textContent = duration > 0 ? `-${formatClock(Math.max(0, duration - t))}` : '';
      const value = `${formatClock(t)} of ${formatClock(duration)}`;
      track.current?.setAttribute('aria-valuenow', String(second));
      track.current?.setAttribute('aria-valuetext', value);
    }
  }, [getTime, duration]);

  // Paint every frame while playing (or scrubbing); once when paused, or when the track changes.
  useEffect(() => {
    shownSecond.current = -1;
    paint();
    if (!playing && !dragging) return;
    let frame = 0;
    const loop = () => { paint(); frame = requestAnimationFrame(loop); };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [paint, playing, dragging]);

  const at = (clientX: number): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || duration <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
  };

  const showTip = (clientX: number, mouse: boolean) => {
    const el = tip.current;
    const rect = track.current?.getBoundingClientRect();
    if (!el || !rect || !mouse || duration <= 0) return;
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    el.style.transform = `translateX(${x}px) translateX(-50%)`;
    el.textContent = formatClock(at(clientX));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (duration <= 0 || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrub.current = at(e.clientX);
    setDragging(true);
    paint();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    showTip(e.clientX, e.pointerType === 'mouse');
    if (scrub.current === null) return;
    scrub.current = at(e.clientX);
    paint();
  };
  const finish = (commit: boolean) => {
    const value = scrub.current;
    scrub.current = null;
    setDragging(false);
    if (commit && value !== null) onSeek(value);
    shownSecond.current = -1;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (duration <= 0) return;
    const now = getTime();
    const step = e.shiftKey ? 15 : 5;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = now + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = now - step;
    else if (e.key === 'PageUp') next = now + 30;
    else if (e.key === 'PageDown') next = now - 30;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = duration - 1;
    if (next === null) return;
    e.preventDefault();
    onSeek(Math.max(0, Math.min(duration - 0.5, next)));
    shownSecond.current = -1;
    requestAnimationFrame(paint);
  };

  const b = duration > 0 ? Math.max(0, Math.min(1, buffered / duration)) : 0;

  return (
    <div className={`seek seek--${size}${dragging ? ' is-dragging' : ''}${duration <= 0 ? ' is-idle' : ''}`} ref={root} style={{ ['--b' as string]: b }}>
      {times === 'sides' && <span className="seek-time" ref={elapsedEl}>0:00</span>}
      <div
        ref={track}
        className="seek-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={0}
        aria-disabled={duration <= 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => finish(true)}
        onPointerCancel={() => finish(false)}
        onKeyDown={onKeyDown}
      >
        <div className="seek-rail">
          <div className="seek-buffer" />
          <div className="seek-fill" />
        </div>
        <div className="seek-thumb" />
        <span className="seek-tip" ref={tip} aria-hidden="true" />
      </div>
      {times === 'sides' && <span className="seek-time seek-time--end" ref={remainingEl}>{duration > 0 ? `-${formatClock(duration)}` : ''}</span>}
    </div>
  );
}
