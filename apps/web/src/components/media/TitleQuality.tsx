import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Kind = 'movie' | 'series' | 'artist';

/** Change the quality a tracked title downloads in (e.g. move a movie to 4K, or down to 720p). */
export function TitleQuality({ mediaType, id }: { mediaType: Kind; id: string }) {
  const [data, setData] = useState<{ profiles: Array<{ id: number; name: string }>; current: number | null } | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api.titleQuality(mediaType, id).then(d => { if (alive) { setData(d); setPick(d.current); } }).catch(() => {});
    return () => { alive = false; };
  }, [mediaType, id]);

  if (!data || data.profiles.length < 2) return null;
  const currentName = data.profiles.find(p => p.id === data.current)?.name ?? 'unknown';
  const changed = pick !== null && pick !== data.current;

  const apply = async () => {
    if (pick === null) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await api.setTitleQuality(mediaType, id, pick);
      setData(d => (d ? { ...d, current: pick } : d));
      setNote({ tone: 'ok', text: res.message });
    } catch (err) {
      setNote({ tone: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page title-quality">
      <div className="rail-head"><h2 className="rail-title">Download quality</h2></div>
      <p className="detail-story-source">
        Currently set to <strong>{currentName}</strong>. Pick a different profile to have it searched again in that quality
        (for example Ultra-HD if you have a 4K screen, or 720p to save space).
      </p>
      <div className="title-quality-row">
        <select className="settings-input" value={pick ?? ''} onChange={e => setPick(Number(e.target.value))} aria-label="Quality profile">
          {data.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" type="button" disabled={!changed || busy} onClick={() => void apply()}>
          {busy ? 'Applying…' : 'Get this quality'}
        </button>
      </div>
      {note && <div className={`notice notice--${note.tone}`}>{note.text}</div>}
    </section>
  );
}
