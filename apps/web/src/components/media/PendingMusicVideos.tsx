import { useEffect, useState } from 'react';
import { api, type MusicVideoJob } from '../../lib/api';

/** Concert and video downloads that could not be matched to an artist by themselves. Administrators only. */
export function PendingMusicVideos({ onFiled }: { onFiled: () => void }) {
  const [jobs, setJobs] = useState<MusicVideoJob[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () => { api.pendingMusicVideos().then(r => setJobs(r.jobs)).catch(() => setJobs([])); };
  useEffect(() => { load(); }, []);

  const file = async (job: MusicVideoJob) => {
    const artist = (names[job.hash] ?? '').trim();
    if (!artist) return;
    setBusy(job.hash); setNote(null);
    try {
      const r = await api.fileMusicVideo(job.hash, artist, job.kind);
      setNote(r.message);
      load(); onFiled();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not file it.');
    } finally {
      setBusy(null);
    }
  };

  if (jobs.length === 0 && !note) return null;
  return (
    <section className="mv-pending" aria-label="Concerts and videos waiting for an artist">
      <h2 className="section-title">{jobs.length ? 'Which artist is this?' : 'Filed'}</h2>
      <p className="mv-pending-help">These downloads look like concerts or music videos, but the name does not say who the artist is. Type the artist and it is filed under them (created if new).</p>
      {jobs.map(job => (
        <div key={job.hash} className="mv-pending-row">
          <span className="mv-pending-name" title={job.name}>{job.name}</span>
          <input className="settings-input" placeholder="Artist name" aria-label={`Artist for ${job.name}`} value={names[job.hash] ?? ''} maxLength={120}
            onChange={e => setNames(n => ({ ...n, [job.hash]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') void file(job); }} />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy === job.hash || !(names[job.hash] ?? '').trim()} onClick={() => void file(job)}>
            {busy === job.hash ? 'Filing...' : 'File it'}
          </button>
        </div>
      ))}
      {note && <p className="mv-pending-note" role="status">{note}</p>}
    </section>
  );
}
