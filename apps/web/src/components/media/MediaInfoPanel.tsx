import { useEffect, useState } from 'react';
import type { MediaPlaybackInfo } from '../../lib/api';
import { formatBytes, languageName, resolutionLabel } from '../../lib/media-info';

/** File details: resolution, codecs, tracks, size. */
export function MediaInfoPanel({ load }: { load: () => Promise<MediaPlaybackInfo> }) {
  const [info, setInfo] = useState<MediaPlaybackInfo | null>(null);
  useEffect(() => { let alive = true; load().then(i => { if (alive) setInfo(i); }).catch(() => {}); return () => { alive = false; }; }, [load]);
  if (!info) return null;
  const minutes = info.durationSeconds ? Math.round(info.durationSeconds / 60) : 0;
  const rows: Array<[string, string]> = [
    ['Resolution', [resolutionLabel(info.height), info.width && info.height ? `${info.width}×${info.height}` : ''].filter(Boolean).join(' · ')],
    ['Container', info.container.toUpperCase()],
    ['Video', (info.videoCodec ?? '').toUpperCase()],
    ['Audio', (info.audioTracks ?? []).map(t => `${t.title || languageName(t.language)} (${t.codec.toUpperCase()}${t.channels ? ` ${t.channels}ch` : ''})`).join(', ')],
    ['Subtitles', (info.subtitleStreams ?? []).map(t => `${t.title || languageName(t.language)}${t.text ? '' : ' (image)'}`).join(', ')],
    ['Size', formatBytes(info.sizeBytes)],
    ['Length', minutes ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : ''],
    ['Bitrate', info.bitrate ? `${(info.bitrate / 1_000_000).toFixed(1)} Mbps` : ''],
    ['Playback', info.playable ? 'Direct play in this browser' : info.transcodingAvailable ? `Converted on the fly (${info.reason ?? 'format not supported'})` : 'Not playable in this browser']
  ].filter(([, v]) => v) as Array<[string, string]>;
  if (rows.length === 0) return null;
  return (
    <dl className="media-info">
      {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
    </dl>
  );
}
