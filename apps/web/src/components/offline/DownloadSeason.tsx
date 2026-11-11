import { useState } from 'react';
import type { EpisodeItem } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';
import { clearQueue, enqueue, episodeMeta, overallPercent, setPaused, useQueue } from '../../lib/offline-queue';
import { keepEnabled, KEEP_COUNT, setKeep } from '../../lib/offline-auto';
import { rememberQuality, type OfflineQuality } from '../../lib/offline-plan';
import QualityPicker from './QualityPicker';
import './DownloadButton.css';

/** Overall progress of whatever is queued, with pause and resume. Shows nothing when the queue is empty. */
export function QueueStatus() {
  const { jobs, paused } = useQueue();
  if (jobs.length === 0) return null;
  const done = jobs.filter(j => j.status === 'done').length;
  const failed = jobs.filter(j => j.status === 'failed');
  const finished = done + failed.length === jobs.length;
  const current = jobs.find(j => j.status === 'saving');
  const percent = overallPercent(jobs);
  return (
    <div className="offline-queue" role="status" aria-label="Download progress">
      <div className="offline-queue-line">
        <span>
          {finished ? `${done} of ${jobs.length} saved to this device` : paused ? `Paused at ${done} of ${jobs.length}` : `Saving ${done + 1} of ${jobs.length}${current ? `: ${current.meta.title}` : ''}`}
        </span>
        {!finished && (
          <button type="button" className="btn btn-secondary" onClick={() => setPaused(!paused)}>{paused ? 'Resume' : 'Pause'}</button>
        )}
        {finished && <button type="button" className="btn btn-secondary" onClick={clearQueue}>Dismiss</button>}
      </div>
      <div className="offline-queue-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Overall progress"><span style={{ width: `${percent}%` }} /></div>
      {failed.length > 0 && <p className="offline-dl-message">{failed[0].error}{failed.length > 1 ? ` (${failed.length} failed)` : ''}</p>}
    </div>
  );
}

/** "Download season" and "Keep the next 3 episodes" for one series page. */
export default function DownloadSeason({ seriesId, seriesTitle, seasonLabel, episodes }: { seriesId: string; seriesTitle: string; seasonLabel: string; episodes: EpisodeItem[] }) {
  const [picking, setPicking] = useState(false);
  const [keep, setKeepState] = useState(() => keepEnabled(seriesId));
  const playable = episodes.filter(e => e.hasFile);
  const seconds = playable.reduce((sum, e) => sum + (e.runtime ?? 0) * 60, 0) || null;

  const start = (quality: OfflineQuality) => {
    rememberQuality(quality);
    setPicking(false);
    void enqueue(playable.map(e => episodeMeta(e, seriesTitle, quality)));
  };

  if (playable.length === 0) return null;
  return (
    <div className="offline-season">
      <div className="offline-season-actions">
        <button type="button" className="btn btn-secondary" aria-expanded={picking} onClick={() => setPicking(p => !p)}>
          <SvgIcon name="download" size={14} /> Download {seasonLabel.toLowerCase()}
        </button>
        <button type="button" className={`btn btn-secondary${keep ? ' is-on' : ''}`} aria-pressed={keep} onClick={() => { setKeepState(!keep); setKeep(seriesId, seriesTitle, !keep); }}>
          Keep the next {KEEP_COUNT} episodes on this device
        </button>
      </div>
      {picking && <QualityPicker seconds={seconds} onPick={start} />}
      <QueueStatus />
    </div>
  );
}
