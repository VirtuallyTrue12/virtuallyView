import { useCallback, useEffect, useState } from 'react';
import { api, type RadioRecording, type RadioStation } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';
import { toast } from '../ui/Toast';
import { useRadio } from './RadioProvider';

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const size = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
const fail = (err: unknown) => toast((err as Error).message, { tone: 'err' });

/** Shows after the first recording: what is recording, what is done, with play, download and delete. */
export function RadioRecordings() {
  const radio = useRadio();
  const [list, setList] = useState<RadioRecording[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { api.radioRecordings().then(r => setList(r.recordings)).catch(() => setList(l => l ?? [])); }, []);
  useEffect(load, [load, radio.recordTick]);
  const running = !!list?.some(r => r.state === 'recording');
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [running, load]);
  if (!list?.length) return null;

  const play = (r: RadioRecording) => {
    if (radio.state === 'playing' || radio.state === 'loading') radio.toggle();
    setOpen(open === r.id ? null : r.id);
  };
  const stop = (r: RadioRecording) => api.radioStopRecording(r.id).then(load).catch(fail);
  const remove = (r: RadioRecording) => {
    if (!window.confirm(`Delete the recording "${r.title}"? The file is removed from the server.`)) return;
    api.radioDeleteRecording(r.id).then(load).catch(fail);
  };

  return (
    <section className="rd-row rd-rec" aria-label="Recordings">
      <h2 className="rd-row-title">Recordings</h2>
      <ul className="rd-rec-list">
        {list.map(r => {
          const minutes = Math.max(1, Math.round((Date.parse(r.endsAt) - Date.parse(r.startedAt)) / 60000));
          const playable = (r.state === 'done' || r.state === 'stopped') && r.sizeBytes > 0;
          return (
            <li key={r.id} className={`rd-rec-item is-${r.state}`}>
              <div className="rd-rec-info">
                <strong>{r.title}</strong>
                <span className="rd-rec-state">
                  {r.state === 'recording' && <><i className="rd-rec-dot" aria-hidden="true" />Recording until {clockTime(r.endsAt)}</>}
                  {r.state === 'done' && `${minutes} min · ${size(r.sizeBytes)}`}
                  {r.state === 'stopped' && `Stopped early · ${size(r.sizeBytes)}`}
                  {r.state === 'failed' && <span role="alert">Failed{r.message ? `: ${r.message}` : ''}</span>}
                </span>
              </div>
              <div className="rd-rec-actions">
                {r.state === 'recording' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void stop(r)} aria-label={`Stop recording ${r.title}`}><SvgIcon name="stop" size={14} /> Stop</button>}
                {playable && <button type="button" className="btn btn-secondary btn-sm" onClick={() => play(r)} aria-label={`Play recording ${r.title}`}><SvgIcon name="play" size={14} /> {open === r.id ? 'Hide' : 'Play'}</button>}
                {playable && <a className="btn btn-secondary btn-sm" href={`/api/radio/recordings/${r.id}/file`} download={`${r.title}.m4a`} aria-label={`Download recording ${r.title}`}><SvgIcon name="download" size={14} /> Download</a>}
                {r.state !== 'recording' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(r)} aria-label={`Delete recording ${r.title}`}><SvgIcon name="trash" size={14} /> Delete</button>}
              </div>
              {open === r.id && playable && <audio className="rd-rec-audio" controls autoPlay src={`/api/radio/recordings/${r.id}/file`} aria-label={r.title} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Wake alarm: starts a station at a set time, with a slow fade-in, while this page is open. */
export function RadioAlarmPanel({ stations }: { stations: RadioStation[] }) {
  const { alarm, setAlarm, station } = useRadio();
  const [time, setTime] = useState('07:00');
  const [id, setId] = useState('');
  const chosen = stations.find(s => s.id === (id || station?.id)) ?? stations[0];
  if (!chosen && !alarm) return null;
  return (
    <section className="rd-row rd-alarm" aria-label="Wake alarm">
      <h2 className="rd-row-title">Wake alarm</h2>
      {alarm ? (
        <p className="rd-alarm-set">Alarm {alarm.time.replace(/^0/, '')} · {alarm.station.name}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAlarm(null)}>Clear alarm</button></p>
      ) : chosen && (
        <div className="rd-alarm-form">
          <label className="rd-field"><span>Time</span><input type="time" value={time} onChange={e => setTime(e.target.value)} aria-label="Alarm time" /></label>
          <label className="rd-field"><span>Station</span>
            <select value={chosen.id} onChange={e => setId(e.target.value)} aria-label="Alarm station">{stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <button type="button" className="btn btn-primary" disabled={!time} onClick={() => setAlarm({ time, station: chosen })}>Set alarm</button>
        </div>
      )}
      <p className="ui-help">The alarm only works while virtuallyView stays open and awake, in a browser tab, on your phone or on the TV. It starts the station quietly and fades up over 30 seconds.</p>
    </section>
  );
}
