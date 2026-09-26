import { useEffect, useMemo, useRef } from 'react';
import type { LiveChannel, LiveProgramme } from '../../lib/api';

const PX_PER_MIN = 4.2;
const HOURS = 6;
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Channels down the side, the next few hours across: click any programme to watch that channel. */
export function GuideGrid({ channels, guide, playingId, onPlay, favorites }: { channels: LiveChannel[]; guide: Record<string, LiveProgramme[]>; playingId?: string | undefined; onPlay: (c: LiveChannel) => void; favorites: Set<string> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const t0 = useMemo(() => { const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); return d.getTime(); }, []);
  const width = HOURS * 60 * PX_PER_MIN;
  const ticks = Array.from({ length: HOURS * 2 }, (_, i) => t0 + i * 30 * 60_000);
  const nowX = ((Date.now() - t0) / 60_000) * PX_PER_MIN;

  // Start a little before "now" so the current programme is in view.
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, nowX - 60); }, [nowX]);

  return (
    <div className="gg" role="table" aria-label="Program guide">
      <div className="gg-scroll" ref={scroller}>
        <div className="gg-inner" style={{ width: width + 190 }}>
          <div className="gg-head" role="row">
            <div className="gg-corner" />
            <div className="gg-ticks" style={{ width }}>{ticks.map(t => <span key={t} style={{ width: 30 * PX_PER_MIN }}>{clock(t)}</span>)}</div>
          </div>
          {channels.map(c => {
            const list = guide[c.id] ?? [];
            return (
              <div className={`gg-row${playingId === c.id ? ' is-playing' : ''}`} role="row" key={c.id}>
                <button type="button" className="gg-chan" onClick={() => onPlay(c)} title={c.name}>
                  {c.logo ? <img src={c.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="gg-fallback">{c.name.charAt(0)}</span>}
                  <span>{favorites.has(c.id) ? '♥ ' : ''}{c.name}</span>
                </button>
                <div className="gg-track" style={{ width }}>
                  {list.length === 0 && <span className="gg-none">{c.guide ? 'No programme information' : 'No guide for this channel'}</span>}
                  {list.map(p => {
                    const left = Math.max(0, ((p.start - t0) / 60_000) * PX_PER_MIN);
                    const right = Math.min(width, ((p.stop - t0) / 60_000) * PX_PER_MIN);
                    if (right - left < 6) return null;
                    const live = p.start <= Date.now() && p.stop > Date.now();
                    return <button type="button" key={`${p.start}-${p.title}`} className={`gg-prog${live ? ' is-live' : ''}`} style={{ left, width: right - left - 2 }} onClick={() => onPlay(c)} title={`${p.title} · ${clock(p.start)}–${clock(p.stop)}${p.desc ? `\n${p.desc}` : ''}`}><strong>{p.title}</strong><span>{clock(p.start)}</span></button>;
                  })}
                </div>
              </div>
            );
          })}
          {nowX > 0 && nowX < width && <div className="gg-now" style={{ left: 190 + nowX }} aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}
