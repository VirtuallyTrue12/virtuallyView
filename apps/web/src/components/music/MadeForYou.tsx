import { useEffect, useState } from 'react';
import { api, type MusicMix } from '../../lib/api';
import { useMusicPlayer } from '../media/MusicProvider';
import { SvgIcon } from '../ui/SvgIcon';
import { queueEntryOf } from './music-queue';
import './MusicDiscovery.css';

/** Up to three mixes made for this listener. They change each Monday. */
export default function MadeForYou() {
  const { playQueue } = useMusicPlayer();
  const [mixes, setMixes] = useState<MusicMix[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.musicMixes()
      .then(res => { if (!cancelled) { setMixes(res.mixes); setMessage(res.message ?? null); } })
      .catch(() => { if (!cancelled) { setMixes([]); setMessage('Mixes are not available right now.'); } });
    return () => { cancelled = true; };
  }, []);

  if (mixes === null) return null;
  if (!mixes.length) {
    return message ? <p className="made-for-you-note">{message}</p> : null;
  }

  return (
    <section className="made-for-you" aria-label="Made for you">
      <div className="rail-head">
        <h2 className="rail-title">Made for you</h2>
        <span className="page-count">Changes every Monday</span>
      </div>
      <div className="mix-row">
        {mixes.map(mix => (
          <button
            key={mix.id}
            type="button"
            className="mix-card"
            aria-label={`Play ${mix.name}`}
            onClick={() => playQueue(mix.tracks.map(queueEntryOf), 0)}
          >
            <span className="mix-cover" aria-hidden="true">
              {mix.covers.length
                ? mix.covers.slice(0, 4).map((src, i) => <img key={`${src}-${i}`} src={src} alt="" loading="lazy" />)
                : <span className="mix-cover-empty"><SvgIcon name="music-note" size={28} /></span>}
            </span>
            <span className="mix-name">{mix.name}</span>
            <span className="mix-blurb">{mix.blurb}</span>
            <span className="mix-count">{mix.tracks.length} tracks</span>
          </button>
        ))}
      </div>
    </section>
  );
}
