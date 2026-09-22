import { Link } from 'react-router-dom';
import { downloadLabel, timeLeft, useTitleDownload } from '../../lib/useDownloadProgress';

/** Live download progress for one title, shown on its page while it downloads. */
export function DownloadPanel({ mediaId }: { mediaId: string }) {
  const download = useTitleDownload(mediaId);
  if (!download) return null;
  const left = download.state === 'downloading' ? timeLeft(download.eta) : '';
  const bits = [left, download.state === 'downloading' ? download.speed : ''].filter(Boolean);
  return (
    <div className={`download-panel download-panel--${download.state}`} role="status">
      <div className="download-panel-head">
        <strong>{downloadLabel(download)}</strong>
        {bits.length > 0 && <span>{bits.join(' · ')}</span>}
        <Link to="/downloads">Details</Link>
      </div>
      {download.state !== 'failed' ? (
        <div className="download-panel-track" role="progressbar" aria-valuenow={Math.round(download.progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="download-panel-fill" style={{ width: `${download.state === 'importing' ? 100 : Math.max(2, download.progress)}%` }} />
        </div>
      ) : (
        <p className="download-panel-msg">{download.message ?? 'The download stopped. Open Details to retry it.'}</p>
      )}
    </div>
  );
}
