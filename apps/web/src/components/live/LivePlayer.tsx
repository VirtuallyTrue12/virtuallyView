import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import type { LiveChannel, LiveProgramme } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export interface LivePlayerProps {
  channel: LiveChannel;
  number: number;
  now?: LiveProgramme | undefined;
  next?: LiveProgramme | undefined;
  favorite: boolean;
  onFavorite: () => void;
  onZap: (by: number) => void;
  onRecord: () => void;
  onClose: () => void;
  onPlaying: () => void;
}

/** One channel playing: HLS through hls.js, anything else as a converted stream, with zapping, favorite, record and picture-in-picture. */
export function LivePlayer({ channel, number, now, next, favorite, onFavorite, onZap, onRecord, onClose, onPlaying }: LivePlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const canPip = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    setError(''); setLoading(true);
    const src = `/api/live/stream/${channel.id}`;
    let hls: Hls | null = null;
    let cancelled = false;
    fetch(src, { headers: { Range: 'bytes=0-0' } }).then(async res => {
      if (cancelled) return;
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { message?: string }; throw new Error(b.message ?? 'The channel did not answer.'); }
      void res.body?.cancel();
      if (/mpegurl/i.test(type) && Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true });
        hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) setError('This channel stopped or could not be played.'); });
        hls.loadSource(src);
        hls.attachMedia(el);
      } else el.src = src;
      void el.play().catch(() => undefined);
    }).catch(err => { if (!cancelled) setError((err as Error).message); });
    // Free public channels go offline often. Say so instead of sitting at 0:00.
    const watchdog = window.setTimeout(() => { if (el.currentTime === 0) setError('This channel is not answering. Free public channels often go offline or only broadcast at certain hours. Try another one.'); }, 15000);
    const playing = () => { window.clearTimeout(watchdog); setError(''); setLoading(false); onPlaying(); };
    el.addEventListener('playing', playing, { once: true });
    return () => { cancelled = true; window.clearTimeout(watchdog); el.removeEventListener('playing', playing); hls?.destroy(); el.removeAttribute('src'); el.load(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const pct = now ? Math.min(100, Math.max(0, ((Date.now() - now.start) / (now.stop - now.start)) * 100)) : 0;
  return (
    <section className="lv-player" aria-label={`Playing ${channel.name}`}>
      <div className="lv-screen">
        <video ref={video} controls autoPlay playsInline className="lv-video" />
        {loading && !error && <div className="lv-loading" aria-hidden="true"><span /></div>}
        {error && (
          <div className="lv-error" role="alert">
            <p>{error}</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onZap(1)}>Try the next channel <SvgIcon name="arrow-right" size={14} /></button>
          </div>
        )}
      </div>
      <div className="lv-info">
        <div className="lv-title">
          <span className="lv-num">{number}</span>
          <div><strong>{channel.name}</strong><span>{channel.group ?? 'Live'}</span></div>
          <button type="button" className="lv-x" onClick={onClose} aria-label="Close the player"><SvgIcon name="close" size={18} /></button>
        </div>
        {now && (
          <div className="lv-now">
            <div className="lv-now-row"><span className="ui-pill ui-pill--bad">Now</span><strong>{now.title}</strong><em>{clock(now.start)}–{clock(now.stop)}</em></div>
            <div className="rq-bar"><div style={{ width: `${pct}%` }} /></div>
            {now.desc && <p>{now.desc}</p>}
            {next && <p className="lv-next"><span>Next</span> {next.title} <em>{clock(next.start)}</em></p>}
          </div>
        )}
        <div className="lv-controls">
          <button type="button" className="btn btn-secondary" onClick={() => onZap(-1)} aria-label="Previous channel" title="Previous channel (↑)"><SvgIcon name="chevron-up" size={18} /></button>
          <button type="button" className="btn btn-secondary" onClick={() => onZap(1)} aria-label="Next channel" title="Next channel (↓)"><SvgIcon name="chevron-down" size={18} /></button>
          <button type="button" className={`btn btn-secondary${favorite ? ' is-on' : ''}`} onClick={onFavorite} aria-pressed={favorite} aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}><SvgIcon name={favorite ? 'heart' : 'heart-outline'} size={18} /></button>
          {canPip && <button type="button" className="btn btn-secondary" onClick={() => { const el = video.current; if (!el) return; if (document.pictureInPictureElement) void document.exitPictureInPicture(); else void el.requestPictureInPicture().catch(() => undefined); }} aria-label="Keep watching in a small window" title="Small window"><SvgIcon name="pip" size={18} /></button>}
          <button type="button" className="btn btn-secondary" onClick={onRecord}><span className="lv-rec" aria-hidden="true" /> Record</button>
        </div>
      </div>
    </section>
  );
}
