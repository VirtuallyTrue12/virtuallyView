import { useEffect, useRef, useState } from 'react';
import { useMusicPlayer } from '../media/MusicProvider';
import { useArtworkTint } from '../../lib/artwork-tint';
import { setViz, useLyricLine, useLyrics, useViz } from '../../lib/viz-store';
import { SvgIcon } from '../ui/SvgIcon';
import { LyricStyleToggle, LyricsOverlay, SceneTiles, VizCanvas, type MoodPick } from './Visualizer';
import { SCENE_BY_ID } from './viz-scenes';
import { MOOD_LABEL } from '../../lib/mood';

const IDLE_MS = 60_000;

/**
 * The visualizer on the whole screen, over any page: the song, its lyrics and the controls fade away while you
 * watch and come back when the mouse moves. It also starts by itself after a minute without input while music
 * plays (a screensaver), and then any key or move closes it again.
 */
export default function VizStage() {
  const { entry, playing, getTime, toggle, nextTrack, prevTrack, djTalking } = useMusicPlayer();
  const viz = useViz();
  const open = viz.stage !== 'closed';
  const tint = useArtworkTint(entry?.cover);
  const lyrics = useLyrics(entry?.artistTitle, entry?.track.title, entry?.albumTitle, entry?.track.durationMs ? entry.track.durationMs / 1000 : undefined, open && viz.lyricStyle !== 'off');
  const line = useLyricLine(lyrics, getTime, open);
  const [chrome, setChrome] = useState(true);
  const [picker, setPicker] = useState(false);
  const [moodPick, setMoodPick] = useState<MoodPick | null>(null);
  const hideTimer = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  // Screensaver: a minute with no input while music plays.
  useEffect(() => {
    if (!viz.screensaver || !playing || open) return;
    let last = Date.now();
    const poke = () => { last = Date.now(); };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, poke, { passive: true }));
    const id = window.setInterval(() => {
      // Not over a video or a dialog someone is reading: only when nothing else is playing on the page.
      const busy = [...document.querySelectorAll('video')].some(v => !v.paused);
      if (!document.hidden && !busy && Date.now() - last > IDLE_MS) setViz({ stage: 'auto' });
    }, 5000);
    return () => { events.forEach(e => window.removeEventListener(e, poke)); window.clearInterval(id); };
  }, [viz.screensaver, playing, open]);

  // Opened by the screensaver: the first touch of anything closes it.
  useEffect(() => {
    if (viz.stage !== 'auto') return;
    const close = () => setViz({ stage: 'closed' });
    const armed = window.setTimeout(() => {
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(e => window.addEventListener(e, close, { once: true, capture: true }));
      window.addEventListener('pointermove', onMove, { capture: true });
    }, 600);
    let moved = 0;
    function onMove(e: PointerEvent) { moved += Math.abs(e.movementX) + Math.abs(e.movementY); if (moved > 40) close(); }
    return () => {
      window.clearTimeout(armed);
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(e => window.removeEventListener(e, close, { capture: true }));
      window.removeEventListener('pointermove', onMove, { capture: true });
    };
  }, [viz.stage]);

  // Opened on purpose: Esc closes, the controls hide after three quiet seconds.
  useEffect(() => {
    if (viz.stage !== 'open') return;
    root.current?.focus({ preventScroll: true });
    const wake = () => {
      setChrome(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setChrome(false), 3000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (picker) setPicker(false); else setViz({ stage: 'closed' }); }
      else if (e.key === ' ' && e.target === root.current) { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' && e.target === root.current) nextTrack();
      else if (e.key === 'ArrowLeft' && e.target === root.current) prevTrack();
      wake();
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointermove', wake); window.removeEventListener('keydown', onKey); window.clearTimeout(hideTimer.current); };
  }, [viz.stage, picker, toggle, nextTrack, prevTrack]);

  useEffect(() => { if (!open) setPicker(false); }, [open]);
  useEffect(() => {
    document.body.classList.toggle('has-viz-stage', open);
    return () => document.body.classList.remove('has-viz-stage');
  }, [open]);

  if (!open || !entry) return null;
  const auto = viz.stage === 'auto';
  const showChrome = !auto && (chrome || picker);
  const lyricState = lyrics === undefined ? 'loading' : lyrics?.synced?.length ? 'ok' : 'none';

  return (
    <div ref={root} tabIndex={-1} onPointerDown={e => { if (picker && !(e.target as HTMLElement).closest('.vstage-picker, .vstage-pill')) setPicker(false); }} className={`vstage${showChrome ? '' : ' is-quiet'}${auto ? ' is-auto' : ''}`} role="dialog" aria-modal="true" aria-label="Visualizer" style={{ ['--np-tint' as string]: tint }}>
      <VizCanvas scene={viz.scene} tint={tint} className="vstage-canvas" onMood={setMoodPick} stage />
      <div className="vstage-lyrics"><LyricsOverlay line={line} style={viz.lyricStyle} size="lg" state={lyricState} /></div>
      {djTalking && <span className="np-dj vstage-dj" role="status"><SvgIcon name="music-note" size={14} /> DJ on the mic</span>}

      <div className="vstage-song">
        {entry.cover && <img className="vstage-cover" src={entry.cover} alt="" />}
        <div>
          <p className="vstage-title">{entry.track.title}</p>
          <p className="vstage-artist">{[entry.artistTitle, entry.albumTitle].filter(Boolean).join(' · ')}</p>
          {viz.scene === 'mood' && moodPick && <p className="vstage-mood">{MOOD_LABEL[moodPick.mood]}{moodPick.byEnergy ? ' (by the beat)' : ''} · {SCENE_BY_ID.get(moodPick.scene)?.name}</p>}
        </div>
      </div>

      {!auto && (
        <>
          <button type="button" className="vstage-close" onClick={() => setViz({ stage: 'closed' })} aria-label="Close visualizer" title="Close (Esc)"><SvgIcon name="close" size={20} /></button>
          <div className="vstage-bar">
            <div className="vstage-transport">
              <button type="button" className="mp-icon" onClick={prevTrack} aria-label="Previous track"><SvgIcon name="prev" size={20} /></button>
              <button type="button" className="mp-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}><SvgIcon name={playing ? 'pause' : 'play'} size={22} /></button>
              <button type="button" className="mp-icon" onClick={nextTrack} aria-label="Next track"><SvgIcon name="next" size={20} /></button>
            </div>
            <LyricStyleToggle />
            <button type="button" className={`vstage-pill${picker ? ' is-on' : ''}`} onClick={() => setPicker(p => !p)} aria-expanded={picker}>Scenes</button>
            <label className="vstage-check">
              <input type="checkbox" checked={viz.screensaver} onChange={e => setViz({ screensaver: e.target.checked })} />
              <span>Start when idle</span>
            </label>
          </div>
          {picker && <div className="vstage-picker"><SceneTiles tint={tint} /></div>}
        </>
      )}
      {auto && <p className="vstage-hint">Move the mouse or press any key to return</p>}
    </div>
  );
}
