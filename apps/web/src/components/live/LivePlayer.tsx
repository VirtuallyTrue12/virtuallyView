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
  wide: boolean;
  onWide: () => void;
}

/** One channel playing: HLS through hls.js, anything else as a converted stream, with zapping, favorite, record and picture-in-picture. */
export function LivePlayer({ channel, number, now, next, favorite, onFavorite, onZap, onRecord, onClose, onPlaying, wide, onWide }: LivePlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const hlsRef = useRef<Hls | null>(null);
  const [mode, setMode] = useState<'live' | 'vod' | 'unknown'>('unknown');
  const [behind, setBehind] = useState(0);
  const canPip = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    setError(''); setLoading(true); setMode('unknown'); setBehind(0);
    const src = `/api/live/stream/${channel.id}`;
    let hls: Hls | null = null;
    let cancelled = false;
    fetch(src, { headers: { Range: 'bytes=0-0' } }).then(async res => {
      if (cancelled) return;
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { message?: string }; throw new Error(b.message ?? 'The channel did not answer.'); }
      void res.body?.cancel();
      if (/mpegurl/i.test(type) && Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true, startPosition: -1 });
        hlsRef.current = hls;
        hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => setMode(data.details.live ? 'live' : 'vod'));
        hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) setError('This channel stopped or could not be played.'); });
        hls.loadSource(src);
        hls.attachMedia(el);
      } else { el.src = src; setMode('live'); }
      void el.play().catch(() => undefined);
    }).catch(err => { if (!cancelled) setError((err as Error).message); });
    // Free public channels go offline often. Say so instead of sitting at 0:00.
    const watchdog = window.setTimeout(() => { if (el.currentTime === 0) setError('This channel is not answering. Free public channels often go offline or only broadcast at certain hours. Try another one.'); }, 15000);
    const playing = () => { window.clearTimeout(watchdog); setError(''); setLoading(false); onPlaying(); };
    el.addEventListener('playing', playing, { once: true });
    // How far behind the live edge the picture is, so a paused or rewound channel can jump back to now.
    const track = () => { const h = hlsRef.current; const edge = h?.liveSyncPosition; setBehind(edge != null && Number.isFinite(edge) ? Math.max(0, Math.round(edge - el.currentTime)) : 0); };
    el.addEventListener('timeupdate', track);
    return () => { cancelled = true; el.removeEventListener('timeupdate', track); hlsRef.current = null; window.clearTimeout(watchdog); el.removeEventListener('playing', playing); hls?.destroy(); el.removeAttribute('src'); el.load(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const goLive = () => { const el = video.current, edge = hlsRef.current?.liveSyncPosition; if (el && edge != null) { el.currentTime = edge; void el.play().catch(() => undefined); } };
  const sporty = /sport|racing|formula|\bf1\b|motor/i.test(`${channel.group ?? ''} ${channel.name}`);
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
          {mode === 'live' && behind <= 20 && <span className="lv-live" title="You are watching the live edge"><i />LIVE</span>}
          {mode === 'live' && behind > 20 && <button type="button" className="lv-live lv-live--behind" onClick={goLive} title="Jump to what is on air now">{behind >= 90 ? `${Math.round(behind / 60)} min` : `${behind} s`} behind · Go live</button>}
          {mode === 'vod' && <span className="lv-live lv-live--vod" title="This stream is a recording, not a live broadcast">Recording</span>}
          <button type="button" className="lv-x" onClick={onClose} aria-label="Close the player"><SvgIcon name="close" size={18} /></button>
        </div>
        {sporty && <p className="lv-hint">Free public sport channels usually replay classic events or highlights. A race weekend that is on right now is normally shown only by a paid broadcaster, through your own subscription or tuner box.</p>}
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
          <button type="button" className="btn btn-secondary lv-wide-btn" onClick={onWide} aria-pressed={wide} aria-label={wide ? 'Make the player smaller' : 'Make the player bigger'} title={wide ? 'Smaller player' : 'Bigger player'}><SvgIcon name={wide ? 'minimize' : 'maximize'} size={18} /></button>
          <button type="button" className="btn btn-secondary" onClick={onRecord}><span className="lv-rec" aria-hidden="true" /> Record</button>
        </div>
      </div>
    </section>
  );
}
