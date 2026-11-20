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
  // Full screen: the picture alone, where the remote's OK pauses and up and down change channel.
  const screen = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [osd, setOsd] = useState(false);
  useEffect(() => {
    const on = () => { const f = !!screen.current && document.fullscreenElement === screen.current; setFull(f); if (f) screen.current?.focus({ preventScroll: true }); };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  // Which channel this is, for a few seconds after a change, since the details under the picture are hidden in full screen.
  useEffect(() => {
    if (!full) return;
    setOsd(true);
    const t = window.setTimeout(() => setOsd(false), 4000);
    return () => window.clearTimeout(t);
  }, [full, channel.id]);
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void screen.current?.requestFullscreen?.().catch(() => undefined); };
  const canPip = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    setError(''); setLoading(true); setMode('unknown'); setBehind(0);
    const src = `/api/live/stream/${channel.id}`;
    let hls: Hls | null = null;
    let cancelled = false;
    // Free channels hiccup: a dropped piece or a broken connection is tried again a few times before saying it stopped.
    let retries = 0;
    let retryTimer: number | undefined;
    const stopped = () => setError('This channel stopped or could not be played.');
    const reconnect = () => {
      if (cancelled || retries >= 3) { if (!cancelled) stopped(); return; }
      retries++;
      setLoading(true);
      retryTimer = window.setTimeout(() => {
        if (cancelled) return;
        if (hls) hls.startLoad();
        else { el.src = src; void el.play().catch(() => undefined); }
      }, 1500 * retries);
    };
    fetch(src, { headers: { Range: 'bytes=0-0' } }).then(async res => {
      if (cancelled) return;
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { message?: string }; throw new Error(b.message ?? 'The channel did not answer.'); }
      void res.body?.cancel();
      if (/mpegurl/i.test(type) && Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true, startPosition: -1 });
        hlsRef.current = hls;
        let mediaRecovered = false;
        hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => setMode(data.details.live ? 'live' : 'vod'));
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) { mediaRecovered = true; hls?.recoverMediaError(); return; }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { reconnect(); return; }
          stopped();
        });
        hls.loadSource(src);
        hls.attachMedia(el);
      } else {
        el.src = src; setMode('live');
        // A converted channel ends or errors when its source drops: connect again.
        el.addEventListener('error', reconnect);
        el.addEventListener('ended', reconnect);
      }
      void el.play().catch(() => undefined);
    }).catch(err => { if (!cancelled) setError((err as Error).message); });
    // Free public channels go offline often. Say so instead of sitting at 0:00.
    const watchdog = window.setTimeout(() => { if (el.currentTime === 0) setError('This channel is not answering. Free public channels often go offline or only broadcast at certain hours. Try another one.'); }, 15000);
    let told = false;
    const playing = () => {
      window.clearTimeout(watchdog); setError(''); setLoading(false); retries = 0;
      if (!told) { told = true; onPlaying(); }
    };
    const waiting = () => setLoading(true);
    el.addEventListener('playing', playing);
    el.addEventListener('waiting', waiting);
    // How far behind the live edge the picture is, so a paused or rewound channel can jump back to now.
    const track = () => { const h = hlsRef.current; const edge = h?.liveSyncPosition; setBehind(edge != null && Number.isFinite(edge) ? Math.max(0, Math.round(edge - el.currentTime)) : 0); };
    el.addEventListener('timeupdate', track);
    return () => {
      cancelled = true; hlsRef.current = null; window.clearTimeout(watchdog); window.clearTimeout(retryTimer);
      for (const [name, fn] of [['timeupdate', track], ['playing', playing], ['waiting', waiting], ['error', reconnect], ['ended', reconnect]] as const) el.removeEventListener(name, fn);
      hls?.destroy(); el.removeAttribute('src'); el.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const goLive = () => { const el = video.current, edge = hlsRef.current?.liveSyncPosition; if (el && edge != null) { el.currentTime = edge; void el.play().catch(() => undefined); } };
  const sporty = /sport|racing|formula|\bf1\b|motor/i.test(`${channel.group ?? ''} ${channel.name}`);
  const pct = now ? Math.min(100, Math.max(0, ((Date.now() - now.start) / (now.stop - now.start)) * 100)) : 0;
  return (
    <section className="lv-player" aria-label={`Playing ${channel.name}`}>
      <div
        ref={screen} className="lv-screen" tabIndex={-1} data-dpad={full ? 'own' : undefined}
        onKeyDown={e => { const v = video.current; if (full && v && e.key === 'Enter') { e.preventDefault(); if (v.paused) void v.play().catch(() => undefined); else v.pause(); } }}
      >
        <video ref={video} controls autoPlay playsInline className="lv-video" />
        {loading && !error && <div className="lv-loading" aria-hidden="true"><span /></div>}
        {full && osd && <div className="lv-osd" role="status"><b>{number}</b> {channel.name}{now ? <span>{now.title}</span> : null}</div>}
        {error && (
          <div className="lv-error" role="alert">
            <p>{error}</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onZap(1)}>Try the next channel <SvgIcon name="arrow-right" size={14} /></button>
          </div>
        )}
      </div>
      <div className="lv-info">
        <div className="lv-title">
          <span className="lv-logo lv-logo--player">{channel.logo ? <img src={channel.logo} alt="" referrerPolicy="no-referrer" /> : <span>{channel.name.charAt(0)}</span>}</span>
          <div><strong>{channel.name}</strong><span>Channel {number}{channel.group ? ` · ${channel.group.split(';')[0]}` : ''}</span></div>
          {mode === 'live' && behind <= 20 && <span className="lv-live" title="You are watching the live edge"><i />LIVE</span>}
          {mode === 'live' && behind > 20 && <button type="button" className="lv-live lv-live--behind" onClick={goLive} title="Jump to what is on air now">{behind >= 90 ? `${Math.round(behind / 60)} min` : `${behind} s`} behind · Go live</button>}
          {mode === 'vod' && <span className="lv-live lv-live--vod" title="This stream is a recording, not a live broadcast">Recording</span>}
          <button type="button" className="icon-btn icon-btn--ghost lv-x" onClick={onClose} aria-label="Close the player"><SvgIcon name="close" size={18} /></button>
        </div>
        {now ? (
          <div className="lv-now">
            <span className="lv-eyebrow">Now · {clock(now.start)}–{clock(now.stop)}</span>
            <strong className="lv-now-title">{now.title}</strong>
            <div className="lv-progress" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
            {now.desc && <p>{now.desc}</p>}
            {next && <p className="lv-next"><span>Up next · {clock(next.start)}</span> {next.title}</p>}
          </div>
        ) : <p className="lv-noguide">No programme information for this channel.</p>}
        {sporty && <p className="lv-hint">Free public sport channels usually replay classic events or highlights. A race weekend that is on right now is normally shown only by a paid broadcaster, through your own subscription or tuner box.</p>}
        <div className="lv-controls">
          <div className="lv-zap" role="group" aria-label="Change channel">
            <button type="button" className="icon-btn" onClick={() => onZap(-1)} aria-label="Previous channel" data-tooltip="Previous channel"><SvgIcon name="chevron-up" size={18} /></button>
            <button type="button" className="icon-btn" onClick={() => onZap(1)} aria-label="Next channel" data-tooltip="Next channel"><SvgIcon name="chevron-down" size={18} /></button>
          </div>
          <button type="button" className={`icon-btn${favorite ? ' is-on' : ''}`} onClick={onFavorite} aria-pressed={favorite} aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}><SvgIcon name={favorite ? 'heart' : 'heart-outline'} size={18} /></button>
          {canPip && <button type="button" className="icon-btn" onClick={() => { const el = video.current; if (!el) return; if (document.pictureInPictureElement) void document.exitPictureInPicture(); else void el.requestPictureInPicture().catch(() => undefined); }} aria-label="Keep watching in a small window" data-tooltip="Small window"><SvgIcon name="pip" size={18} /></button>}
          <button type="button" className="icon-btn lv-wide-btn" onClick={onWide} aria-pressed={wide} aria-label={wide ? 'Make the player smaller' : 'Make the player bigger'} data-tooltip={wide ? 'Smaller player' : 'Bigger player'}><SvgIcon name="widen" size={18} /></button>
          <button type="button" className="icon-btn" onClick={toggleFull} aria-label="Full screen" data-tooltip="Full screen"><SvgIcon name="maximize" size={18} /></button>
          <button type="button" className="btn btn-secondary lv-rec-btn" onClick={onRecord}><span className="lv-rec" aria-hidden="true" /> Record</button>
        </div>
      </div>
    </section>
  );
}
