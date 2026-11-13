import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BookCard } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const clock = (s: number) => { const t = Math.max(0, Math.floor(s)); const h = Math.floor(t / 3600); return `${h ? `${h}:` : ''}${String(Math.floor((t % 3600) / 60)).padStart(h ? 2 : 1, '0')}:${String(t % 60).padStart(2, '0')}`; };
const parse = (pos?: string) => { const [i, s] = (pos ?? '').split(':'); return { track: Math.max(0, Number(i) || 0), sec: Math.max(0, Number(s) || 0) }; };

/** Tracks as chapters, with 30 second jumps, speed, a sleep timer and a position that is kept every 10 seconds. */
export function AudioPlayer({ book, position }: { book: BookCard; position?: string }) {
  const tracks = book.files;
  const audio = useRef<HTMLAudioElement>(null);
  const start = useRef(parse(position));
  const [track, setTrack] = useState(Math.min(start.current.track, tracks.length - 1));
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(start.current.sec);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [sleep, setSleep] = useState(0);
  const resume = useRef(start.current.sec);
  const last = useRef({ track, time: start.current.sec, duration: 0 });

  const save = useCallback(() => {
    const { track: t, time: s, duration: d } = last.current;
    const percent = Math.min(100, ((t + (d > 0 ? s / d : 0)) / tracks.length) * 100);
    api.saveBookState(book.id, { position: `${t}:${s.toFixed(1)}`, percent }).catch(() => {});
  }, [book.id, tracks.length]);

  useEffect(() => { api.saveBookState(book.id, { opened: true }).catch(() => {}); return () => save(); }, [book.id, save]);
  useEffect(() => { if (!playing) return; const t = window.setInterval(save, 10_000); return () => window.clearInterval(t); }, [playing, save]);
  useEffect(() => { if (audio.current) audio.current.playbackRate = speed; }, [speed, track]);
  useEffect(() => {
    if (!sleep) return;
    const t = window.setTimeout(() => { audio.current?.pause(); setSleep(0); }, sleep * 60_000);
    return () => window.clearTimeout(t);
  }, [sleep]);

  const jump = (by: number) => { const a = audio.current; if (a) a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + by)); };
  const toggle = () => { const a = audio.current; if (a) void (a.paused ? a.play().catch(() => {}) : a.pause()); };
  const pick = (i: number) => { resume.current = 0; setTrack(i); setTime(0); window.setTimeout(() => void audio.current?.play().catch(() => {}), 50); };

  return (
    <section className="bk-audio" aria-label="Audiobook player">
      <audio
        ref={audio}
        src={`/api/books/library/${book.id}/file/${tracks[track]?.index ?? 0}`}
        preload="metadata"
        onLoadedMetadata={e => { setDuration(e.currentTarget.duration); last.current.duration = e.currentTarget.duration; if (resume.current) { e.currentTarget.currentTime = resume.current; resume.current = 0; } e.currentTarget.playbackRate = speed; }}
        onTimeUpdate={e => { setTime(e.currentTarget.currentTime); last.current = { track, time: e.currentTarget.currentTime, duration: e.currentTarget.duration || 0 }; }}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); save(); }}
        onEnded={() => { if (track + 1 < tracks.length) pick(track + 1); else { setPlaying(false); api.saveBookState(book.id, { finished: true, percent: 100 }).catch(() => {}); } }}
      />
      <div className="bk-audio-now"><strong>{tracks[track]?.name.replace(/\.[^.]+$/, '')}</strong><span>Chapter {track + 1} of {tracks.length}</span></div>
      <input type="range" className="bk-seek" min={0} max={duration || 0} step={1} value={Math.min(time, duration || 0)} onChange={e => { if (audio.current) audio.current.currentTime = Number(e.target.value); }} aria-label="Position" />
      <div className="bk-audio-times"><span>{clock(time)}</span><span>{duration ? clock(duration) : '--:--'}</span></div>
      <div className="bk-audio-btns">
        <button type="button" className="btn btn-secondary btn-sm" disabled={track === 0} onClick={() => pick(track - 1)} aria-label="Previous chapter"><SvgIcon name="prev" size={16} /></button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => jump(-30)} aria-label="Back 30 seconds">-30</button>
        <button type="button" className="btn btn-primary bk-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}><SvgIcon name={playing ? 'pause' : 'play'} size={22} /></button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => jump(30)} aria-label="Forward 30 seconds">+30</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={track + 1 >= tracks.length} onClick={() => pick(track + 1)} aria-label="Next chapter"><SvgIcon name="next" size={16} /></button>
      </div>
      <div className="bk-audio-opts">
        <label>Speed <select className="settings-input" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{SPEEDS.map(s => <option key={s} value={s}>{s}x</option>)}</select></label>
        <label>Sleep timer <select className="settings-input" value={sleep} onChange={e => setSleep(Number(e.target.value))}><option value={0}>Off</option>{[15, 30, 45, 60].map(m => <option key={m} value={m}>{m} min</option>)}</select></label>
      </div>
      {tracks.length > 1 && (
        <ol className="bk-chapters" aria-label="Chapters">
          {tracks.map((t, i) => <li key={t.index}><button type="button" className={i === track ? 'is-on' : ''} onClick={() => pick(i)} aria-current={i === track || undefined}>{i + 1}. {t.name.replace(/\.[^.]+$/, '')}</button></li>)}
        </ol>
      )}
    </section>
  );
}
