import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';

/** An invite link: look the room up, then open the player with the party attached. */
export default function PartyJoin() {
  const { code } = useParams<{ code: string }>();
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!code) return;
    fetch(`/api/watch-party/${encodeURIComponent(code)}`)
      .then(async res => {
        const data = (await res.json()) as { link?: string; message?: string };
        if (!res.ok || !data.link) throw new Error(data.message ?? 'That watch party has ended or the code is wrong.');
        setTarget(`${data.link}?party=${encodeURIComponent(code.toUpperCase())}`);
      })
      .catch(err => setError((err as Error).message));
  }, [code]);

  if (target) return <Navigate to={target} replace />;
  return <main className="page">{error ? <div className="error-state" role="alert">{error}</div> : <div className="loading-state">Joining the watch party...</div>}</main>;
}
