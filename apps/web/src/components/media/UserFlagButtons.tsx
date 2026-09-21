import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

type Kind = 'movie' | 'series' | 'artist' | 'episode';

/** Add/remove from the signed-in user's My List. */
export function FavoriteButton({ mediaType, mediaId, initial }: { mediaType: Kind; mediaId: string; initial?: boolean }) {
  const [on, setOn] = useState(initial === true);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(initial === true), [initial, mediaId]);
  return (
    <button
      type="button"
      className={`btn btn-secondary${on ? ' is-on' : ''}`}
      aria-pressed={on}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { setOn((await api.setFlags(mediaType, mediaId, { favorite: !on })).favorite); }
        finally { setBusy(false); }
      }}
    >
      <SvgIcon name={on ? 'heart' : 'heart-outline'} size={16} /> {on ? 'In My List' : 'My List'}
    </button>
  );
}

/** Mark watched / unwatched (watched also clears the resume point). */
export function WatchedButton({ mediaType, mediaId, initial, onChange }: {
  mediaType: Kind; mediaId: string; initial?: boolean; onChange?: (watched: boolean) => void;
}) {
  const [on, setOn] = useState(initial === true);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(initial === true), [initial, mediaId]);
  return (
    <button
      type="button"
      className={`btn btn-secondary${on ? ' is-on' : ''}`}
      aria-pressed={on}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const next = (await api.setFlags(mediaType, mediaId, { watched: !on })).watched;
          setOn(next);
          onChange?.(next);
        } finally { setBusy(false); }
      }}
    >
      {on && <SvgIcon name="check" size={16} />} {on ? 'Watched' : 'Mark watched'}
    </button>
  );
}
