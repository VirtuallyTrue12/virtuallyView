import { useEffect, useState } from 'react';
import { api, type VideoResult } from '../../lib/api';
import { VideoRail } from './VideoCards';

/** Trailers, reviews and featurettes for a film or show, from the Videos section. Shows nothing when the video
 * service is off or finds nothing, so a title page never waits on it or shows an empty box. */
export function RelatedVideos({ title, year, kind = 'movie' }: { title: string; year?: number; kind?: 'movie' | 'series' }) {
  const [videos, setVideos] = useState<VideoResult[]>([]);
  useEffect(() => {
    let alive = true;
    setVideos([]);
    if (title) api.videosAbout(title, year, kind).then(r => { if (alive) setVideos(Array.isArray(r.videos) ? r.videos : []); }).catch(() => undefined);
    return () => { alive = false; };
  }, [title, year, kind]);
  if (videos.length === 0) return null;
  return <div className="page vd-about"><VideoRail title="Videos" videos={videos} /></div>;
}
