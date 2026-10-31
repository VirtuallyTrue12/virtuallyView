import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMusicPlayer } from '../components/media/MusicProvider';
import ListenTogether from '../components/music/ListenTogether';

/** An invite link (/music/together/<code>): join the session, then show it. Playback runs in the bar. */
export default function ListenJoin() {
  const { code = '' } = useParams<{ code: string }>();
  const { joinListen } = useMusicPlayer();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setBusy(true);
    void joinListen(code).then(err => {
      if (!alive) return;
      setError(err ?? '');
      setBusy(false);
    });
    return () => { alive = false; };
  }, [code, joinListen]);

  return (
    <main className="page listen-join">
      {busy && <div className="loading-state">Joining the listening session...</div>}
      {!busy && error && <div className="error-state" role="alert">{error}</div>}
      {!busy && !error && <ListenTogether />}
    </main>
  );
}
