import { useState } from 'react';
import { api, type AlbumCredits as Credits, type CreditList } from '../../lib/api';
import './MusicDiscovery.css';

const NONE = 'No credits found for this album.';

function Names({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null;
  return <p className="credit-line"><span className="credit-label">{label}</span> {names.join(', ')}</p>;
}

function CreditBlock({ list }: { list: CreditList }) {
  return (
    <>
      <Names label="Written by" names={list.writers} />
      <Names label="Produced by" names={list.producers} />
      <Names label="Performed by" names={list.performers} />
    </>
  );
}

/**
 * Who wrote, produced and performed the album, from MusicBrainz. Asked for only when
 * the disclosure is opened, and remembered by the server after that.
 */
export default function AlbumCredits({ albumId }: { albumId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [data, setData] = useState<Credits | null>(null);
  const [failed, setFailed] = useState(false);

  const onToggle = (open: boolean) => {
    if (!open || state !== 'idle') return;
    setState('loading');
    api.albumCredits(albumId)
      .then(result => { setData(result); setState('ready'); })
      .catch(() => { setFailed(true); setState('ready'); });
  };

  const hasCredits = data?.status === 'found';

  return (
    <details className="album-credits" onToggle={e => onToggle(e.currentTarget.open)}>
      <summary>Credits</summary>
      <div className="album-credits-body">
        {state === 'loading' && <p className="credit-note">Looking up credits...</p>}
        {state === 'ready' && failed && <p className="credit-note">Credits could not be loaded right now.</p>}
        {state === 'ready' && !failed && data?.status === 'unavailable' && <p className="credit-note">{data.message ?? 'Credits are not available right now.'}</p>}
        {state === 'ready' && !failed && !hasCredits && data?.status !== 'unavailable' && <p className="credit-note">{NONE}</p>}
        {hasCredits && data?.album && (
          <>
            <CreditBlock list={data.album} />
            {(data.tracks ?? []).length > 0 && (
              <ol className="credit-tracks">
                {(data.tracks ?? []).map(track => (
                  <li key={`${track.position}-${track.title}`}>
                    <span className="credit-track-title">{track.title}</span>
                    <CreditBlock list={track} />
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </details>
  );
}
