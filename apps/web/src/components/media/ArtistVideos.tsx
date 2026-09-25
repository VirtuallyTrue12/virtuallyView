import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MusicVideoItem } from '../../lib/api';

const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

function Section({ title, items, artistId, initial }: { title: string; items: MusicVideoItem[]; artistId: string; initial: string }) {
  if (items.length === 0) return null;
  return (
    <section className="album-section" aria-label={title}>
      <div className="rail-head">
        <h2 className="rail-title">{title}</h2>
        <span className="page-count">{items.length}</span>
      </div>
      <div className="mv-grid">
        {items.map(v => (
          <Link key={v.id} className="mv-card" to={`/music/${artistId}/watch/${encodeURIComponent(v.id)}`}>
            <div className="mv-card-frame" aria-hidden="true">
              <span className="mv-card-initial">{initial}</span>
              <span className="mv-card-play"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>
            </div>
            <span className="mv-card-title">{v.title}</span>
            <span className="mv-card-sub">{size(v.sizeBytes)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Concerts and music videos filed under this artist. Shows nothing when there are none. */
export function ArtistVideos({ artistId, artistName, refreshKey = 0 }: { artistId: string; artistName: string; refreshKey?: number }) {
  const [data, setData] = useState<{ concerts: MusicVideoItem[]; videos: MusicVideoItem[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.artistVideos(artistId).then(d => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [artistId, refreshKey]);
  if (!data) return null;
  const initial = artistName[0] ?? '';
  return (
    <>
      <Section title="Concerts" items={data.concerts} artistId={artistId} initial={initial} />
      <Section title="Videos" items={data.videos} artistId={artistId} initial={initial} />
    </>
  );
}
