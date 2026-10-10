import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';

/** A failed save says so for a few seconds instead of the button just re-enabling as if nothing happened. */
function useFailedFlash() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setOn(false), 3000);
    return () => window.clearTimeout(t);
  }, [on]);
  return { on, flash: () => setOn(true) };
}

type Kind = 'movie' | 'series' | 'artist' | 'episode';

/** Add/remove from the signed-in user's My List. */
export function FavoriteButton({ mediaType, mediaId, initial }: { mediaType: Kind; mediaId: string; initial?: boolean }) {
  const [on, setOn] = useState(initial === true);
  const [busy, setBusy] = useState(false);
  const failed = useFailedFlash();
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
        catch { failed.flash(); }
        finally { setBusy(false); }
      }}
    >
      <SvgIcon name={on ? 'heart' : 'heart-outline'} size={16} /> {failed.on ? 'Could not save' : on ? 'In My List' : 'My List'}
    </button>
  );
}

/** Mark watched / unwatched (watched also clears the resume point). */
export function WatchedButton({ mediaType, mediaId, initial, onChange }: {
  mediaType: Kind; mediaId: string; initial?: boolean; onChange?: (watched: boolean) => void;
}) {
  const [on, setOn] = useState(initial === true);
  const [busy, setBusy] = useState(false);
  const failed = useFailedFlash();
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
        } catch { failed.flash(); } finally { setBusy(false); }
      }}
    >
      {on && <SvgIcon name="check" size={16} />} {failed.on ? 'Could not save' : on ? 'Watched' : 'Mark watched'}
    </button>
  );
}
