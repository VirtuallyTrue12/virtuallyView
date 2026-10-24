import { useMusicPlayer } from '../media/MusicProvider';
import { useArtworkTint } from '../../lib/artwork-tint';
import { setViz, useLyricLine, useLyrics, useViz } from '../../lib/viz-store';
import { SvgIcon } from '../ui/SvgIcon';
import { LyricsOverlay, VizCanvas } from './Visualizer';

/** The top of the Music page while something plays: the live visualizer behind the song and its lyrics. */
export default function MusicHero() {
  const { entry, playing, getTime, toggle, nextTrack, setExpanded, djTalking, djMode } = useMusicPlayer();
  const viz = useViz();
  const tint = useArtworkTint(entry?.cover);
  const length = entry?.track.durationMs ? entry.track.durationMs / 1000 : undefined;
  const lyrics = useLyrics(entry?.artistTitle, entry?.track.title, entry?.albumTitle, length, viz.lyricStyle !== 'off');
  const line = useLyricLine(lyrics, getTime, !!entry);
  if (!entry) return null;
  return (
    <section className="mhero" style={{ ['--np-tint' as string]: tint }} aria-label="Now playing">
      <VizCanvas scene={viz.scene} tint={tint} className="mhero-canvas" />
      <div className="mhero-shade" aria-hidden="true" />
      <div className="mhero-body">
        {entry.cover
          ? <img className="mhero-cover" src={entry.cover} alt="" />
          : <span className="mhero-cover mhero-cover--empty" aria-hidden="true"><SvgIcon name="music-note" size={34} /></span>}
        <div className="mhero-text">
          <p className="mhero-kicker">{djTalking ? 'DJ on the mic' : playing ? (djMode ? 'Now playing · DJ mode' : 'Now playing') : 'Paused'}</p>
          <h2 className="mhero-title">{entry.track.title}</h2>
          <p className="mhero-artist">{[entry.artistTitle, entry.albumTitle].filter(Boolean).join(' · ')}</p>
          <div className="mhero-lyric"><LyricsOverlay line={line} style={viz.lyricStyle === 'off' ? 'off' : 'karaoke'} state={lyrics === undefined ? 'loading' : lyrics?.synced?.length ? 'ok' : 'none'} /></div>
          <div className="mhero-actions">
            <button type="button" className="mp-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}><SvgIcon name={playing ? 'pause' : 'play'} size={22} /></button>
            <button type="button" className="mp-icon" onClick={nextTrack} aria-label="Next track"><SvgIcon name="next" size={20} /></button>
            <button type="button" className="chip" onClick={() => setViz({ stage: 'open' })}><SvgIcon name="maximize" size={14} /> Full screen</button>
            <button type="button" className="chip" onClick={() => setExpanded(true)}>Open player</button>
          </div>
        </div>
      </div>
    </section>
  );
}
