import { useEffect, useRef, useState } from 'react';
import { BackButton } from '../layout/BackButton';
import { playInTvApp, type TvPlayRequest } from '../../lib/tv-app';

/**
 * Shown inside the Android TV app in place of the web player: the title starts in the
 * TV's own player, and this screen waits with a Back button.
 */
export function TvAppHandoff({ request, backTo, backLabel }: { request: TvPlayRequest; backTo: string; backLabel: string }) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    playInTvApp(request).catch(err => setError(err instanceof Error ? err.message : 'Could not start it.'));
    // Start once per visit: the request is read when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="player">
      <div className="player-topbar">
        <BackButton to={backTo} label={backLabel} />
        <span className="player-title">{request.title}</span>
      </div>
      <div className="player-stage">
        <div className="player-intro" role="status">
          <div className="player-intro-content">
            <h1 className="player-intro-title">{error ? 'Could not start it' : 'Playing…'}</h1>
            <p className="player-intro-sub">
              {error ?? 'It is playing in the TV app. Press Back on the remote to return here when you are done.'}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
