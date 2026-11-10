import { useEffect, useState } from 'react';
import { api, type LiveChannel, type LiveHighlight, type LiveProgramme } from '../../lib/api';
import { ScrollRow } from '../ui/ScrollRow';
import { SvgIcon } from '../ui/SvgIcon';

const when = (h: LiveHighlight, now: number): string => {
  if (h.live) return 'Live now';
  const mins = Math.round((h.start - now) / 60_000);
  if (mins < 60) return `In ${Math.max(mins, 1)} min`;
  const d = new Date(h.start);
  const today = new Date(now).toDateString() === d.toDateString();
  const tomorrow = new Date(now + 86_400_000).toDateString() === d.toDateString();
  return `${today ? 'Today' : tomorrow ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/**
 * Above the channel list: the big matches and races on now and soon, and the channels of yours that show them.
 * Press a channel to watch. Hidden when there is nothing worth showing or the schedule cannot be reached.
 */
export function Highlights({ channels, playingId, onWatch }: { channels: Map<string, LiveChannel>; playingId?: string | undefined; onWatch: (c: LiveChannel) => void }) {
  const [items, setItems] = useState<LiveHighlight[]>([]);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('vv-live-highlights') !== 'closed'; } catch { return true; } });

  useEffect(() => {
    let alive = true;
    const region = (navigator.language.split('-')[1] ?? '').toUpperCase();
    const load = () => api.liveHighlights(region || undefined).then(r => { if (alive) { setItems(r.highlights); setNow(r.now); } }).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);

  if (items.length === 0) return null;
  const liveCount = items.filter(i => i.live).length;
  const toggle = () => setOpen(v => { const n = !v; try { localStorage.setItem('vv-live-highlights', n ? 'open' : 'closed'); } catch { /* fine */ } return n; });

  return (
    <section className="hl" aria-label="Highlights">
      <div className="hl-top">
        <h2 className="hl-title"><SvgIcon name="zap" size={18} /> Highlights{liveCount > 0 && <span className="hl-live-count">{liveCount} live</span>}</h2>
        <button type="button" className="mp-link" onClick={toggle} aria-expanded={open}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <ScrollRow className="hl-row" label="highlights">
          <div className="hl-cards">
            {items.map(h => {
              const mine = h.channels.map(c => channels.get(c.id)).filter((c): c is LiveChannel => !!c);
              return (
                <article key={h.id} className={`hl-card${h.live ? ' is-live' : ''}`} style={h.thumb ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.82)), url(${h.thumb})` } : undefined}>
                  <div className="hl-meta"><span className={`hl-when${h.live ? ' is-live' : ''}`}>{when(h, now)}</span><span className="hl-league">{h.league || h.sport}</span></div>
                  <h3 className="hl-name">{h.title}</h3>
                  <div className="hl-where">
                    {mine.length > 0
                      ? mine.map(c => <button key={c.id} type="button" className={`hl-chan${playingId === c.id ? ' is-on' : ''}`} onClick={() => onWatch(c)} aria-label={`Watch ${h.title} on ${c.name}`}><SvgIcon name="play" size={12} /> {c.name}</button>)
                      : <span className="hl-else">{h.elsewhere.length ? `On ${h.elsewhere.join(', ')}. Not in your channel lists.` : 'No channel of yours shows this.'}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        </ScrollRow>
      )}
    </section>
  );
}

/** The featured row at the top: what is on now on your favourite and recent channels, one press to watch. */
export function OnNow({ items, playingId, onWatch }: { items: Array<{ channel: LiveChannel; now: LiveProgramme }>; playingId?: string | undefined; onWatch: (c: LiveChannel) => void }) {
  if (items.length === 0) return null;
  const at = Date.now();
  return (
    <section className="on-now" aria-label="On now">
      <h2 className="on-now-title">On now</h2>
      <ScrollRow className="on-now-row" label="on now">
        <div className="on-now-cards">
          {items.map(({ channel: c, now: p }) => (
            <button key={c.id} type="button" className={`on-now-card${playingId === c.id ? ' is-on' : ''}`} onClick={() => onWatch(c)} aria-label={`${p.title} on ${c.name}`}>
              <span className="on-now-art">
                {c.logo ? <img src={c.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="on-now-initial">{c.name.charAt(0)}</span>}
                <span className="on-now-live"><i />{playingId === c.id ? 'Playing' : 'Live'}</span>
              </span>
              <span className="on-now-text">
                <strong>{p.title}</strong>
                <span>{c.name} · {Math.max(1, Math.round((p.stop - at) / 60_000))} min left</span>
              </span>
              <span className="on-now-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, ((at - p.start) / (p.stop - p.start)) * 100)}%` }} /></span>
            </button>
          ))}
        </div>
      </ScrollRow>
    </section>
  );
}
