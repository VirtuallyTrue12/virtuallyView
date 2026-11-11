import { useEffect, useMemo, useRef } from 'react';
import type { LiveChannel, LiveProgramme } from '../../lib/api';

const PX_PER_MIN = 4.2;
const HOURS = 6;
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Channels down the side, the next few hours across: click any programme to watch that channel. */
export function GuideGrid({ channels, guide, playingId, onPlay, favorites, scheduled, onProgramme }: { scheduled?: Set<string>; onProgramme?: ((c: LiveChannel, p: LiveProgramme) => void) | undefined; channels: LiveChannel[]; guide: Record<string, LiveProgramme[]>; playingId?: string | undefined; onPlay: (c: LiveChannel) => void; favorites: Set<string> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const t0 = useMemo(() => { const d = new Date(); d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0); return d.getTime(); }, []);
  const width = HOURS * 60 * PX_PER_MIN;
  const ticks = Array.from({ length: HOURS * 2 }, (_, i) => t0 + i * 30 * 60_000);
  const at = Date.now();
  const nowX = ((at - t0) / 60_000) * PX_PER_MIN;

  // Start a little before "now" so the current programme is in view.
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, nowX - 60); }, [nowX]);

  return (
    <div className="gg" role="table" aria-label="Program guide">
      <div className="gg-scroll" ref={scroller}>
        <div className="gg-inner" style={{ width: `calc(var(--gg-chan) + ${width}px)` }}>
          <div className="gg-head" role="row">
            <div className="gg-corner">Channels</div>
            <div className="gg-ticks" style={{ width }}>{ticks.map(t => <span key={t} style={{ width: 30 * PX_PER_MIN }}>{clock(t)}</span>)}{nowX > 0 && nowX < width && <i className="gg-now-mark" style={{ left: nowX }} aria-hidden="true">{clock(at)}</i>}</div>
          </div>
          {channels.map(c => {
            const list = guide[c.id];
            return (
              <div className={`gg-row${playingId === c.id ? ' is-playing' : ''}`} role="row" key={c.id}>
                <button type="button" className="gg-chan" onClick={() => onPlay(c)} title={c.name} aria-current={playingId === c.id || undefined}>
                  <span className="gg-logo">{c.logo ? <img src={c.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : c.name.charAt(0)}</span>
                  <span className="gg-name">{c.name}{favorites.has(c.id) && <span className="gg-fav" aria-label="Favorite"> ♥</span>}</span>
                </button>
                <div className="gg-track" style={{ width }}>
                  {!list && c.guide && <span className="gg-loading skeleton" style={{ width: Math.min(width, nowX + 360) }} aria-hidden="true" />}
                  {(list?.length === 0 || (!list && !c.guide)) && <span className="gg-none">{c.guide ? 'No programme information' : 'No guide for this channel'}</span>}
                  {list?.map(p => {
                    const left = Math.max(0, ((p.start - t0) / 60_000) * PX_PER_MIN);
                    const right = Math.min(width, ((p.stop - t0) / 60_000) * PX_PER_MIN);
                    if (right - left < 6) return null;
                    const live = p.start <= at && p.stop > at;
                    const past = p.stop <= at;
                    return (
                      <button type="button" key={`${p.start}-${p.title}`} className={`gg-prog${live ? ' is-live' : ''}${past ? ' is-past' : ''}`} style={{ left, width: right - left - 4 }} onClick={() => (onProgramme ? onProgramme(c, p) : onPlay(c))}
                        title={`${p.title} · ${clock(p.start)}–${clock(p.stop)}${p.desc ? `\n${p.desc}` : ''}`}>
                        {scheduled?.has(`${c.id}|${p.start}`) && <i className="gg-rec" role="img" aria-label="Recording scheduled" />}
                        <strong>{p.title}</strong>
                        <span>{live ? `Now · ${Math.max(1, Math.round((p.stop - at) / 60_000))} min left` : `${clock(p.start)}–${clock(p.stop)}`}</span>
                        {live && <i className="gg-prog-bar" style={{ width: `${((at - p.start) / (p.stop - p.start)) * 100}%` }} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {nowX > 0 && nowX < width && <div className="gg-now" style={{ left: `calc(var(--gg-chan) + ${nowX}px)` }} aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}
