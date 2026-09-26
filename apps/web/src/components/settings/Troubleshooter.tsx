import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError, type TroubleCheck } from '../../lib/api';

const ORDER = ['Internet', 'Search', 'Downloads', 'Media', 'Apps', 'Extras'];
const WORD: Record<TroubleCheck['status'], string> = { ok: 'Working', warn: 'Worth a look', fail: 'Not working', skipped: 'Off' };

function Item({ check, onRestart, restarting }: { check: TroubleCheck; onRestart: (service: string) => void; restarting: boolean }) {
  const [open, setOpen] = useState(check.status === 'fail');
  const hasHelp = check.fixes.length > 0 || !!check.restart;
  return (
    <li className={`ts-item ts-item--${check.status}`}>
      <button type="button" className="ts-head" onClick={() => hasHelp && setOpen(v => !v)} aria-expanded={hasHelp ? open : undefined} disabled={!hasHelp}>
        <span className="ts-dot" aria-hidden="true" />
        <span className="ts-text"><strong>{check.label}</strong><span>{check.detail}</span></span>
        <span className="ts-state">{WORD[check.status]}</span>
      </button>
      {open && hasHelp && (
        <div className="ts-help">
          {check.fixes.length > 0 && (<><p className="ts-help-title">What to try</p><ol>{check.fixes.map((f, i) => <li key={i}>{f}</li>)}</ol></>)}
          {check.restart && <button type="button" className="btn btn-secondary btn-sm" disabled={restarting} onClick={() => onRestart(check.restart!)}>{restarting ? 'Restarting…' : `Restart ${check.restart}`}</button>}
        </div>
      )}
    </li>
  );
}

/** One place to find out what is wrong with the stack, in plain words, with what to try and a restart where possible. */
export function Troubleshooter() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.troubleshoot>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [showOk, setShowOk] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try { setData(await api.troubleshoot()); setDenied(false); } catch (err) {
      if ((err as ApiError).status === 403) setDenied(true); else setNote({ tone: 'err', text: err instanceof Error ? err.message : 'The checks could not run.' });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void run(); }, [run]);

  const restart = async (service: string) => {
    setRestarting(service); setNote(null);
    try { setNote({ tone: 'ok', text: (await api.restartService(service)).message }); } catch (err) { setNote({ tone: 'err', text: err instanceof Error ? err.message : 'Could not restart it.' }); } finally { setRestarting(null); }
  };

  if (denied) return null;
  const problems = data?.checks.filter(c => c.status === 'fail' || c.status === 'warn') ?? [];
  const fine = data?.checks.filter(c => c.status === 'ok' || c.status === 'skipped') ?? [];
  const headline = !data ? 'Checking everything…' : problems.length === 0 ? 'Everything you use is working.' : `${problems.length} thing${problems.length === 1 ? '' : 's'} need${problems.length === 1 ? 's' : ''} attention.`;

  return (
    <section className="ts" aria-label="Troubleshooting">
      <div className="ts-top">
        <div>
          <h2 className="ts-title">Troubleshooting</h2>
          <p className={`ts-headline${data && problems.length ? ' has-problems' : ''}`} role="status">{headline}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void run()} disabled={loading}>{loading ? 'Checking…' : 'Check again'}</button>
      </div>
      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
      {data && problems.length > 0 && (
        <ul className="ts-list">
          {ORDER.flatMap(area => problems.filter(c => c.area === area)).map(c => <Item key={c.id} check={c} onRestart={service => void restart(service)} restarting={restarting === c.restart} />)}
        </ul>
      )}
      {data && fine.length > 0 && (
        <div className="ts-fine">
          <button type="button" className="mp-link" onClick={() => setShowOk(v => !v)} aria-expanded={showOk}>{showOk ? 'Hide' : 'Show'} what is fine ({fine.length})</button>
          {showOk && <ul className="ts-list">{ORDER.flatMap(area => fine.filter(c => c.area === area)).map(c => <Item key={c.id} check={c} onRestart={service => void restart(service)} restarting={restarting === c.restart} />)}</ul>}
        </div>
      )}
      <p className="ts-foot">Still stuck? See the <a href="https://github.com/VirtuallyTrue12/virtuallyView/blob/main/docs/troubleshooting.md" target="_blank" rel="noreferrer">troubleshooting guide</a> or open <a href="/diagnostics">Diagnostics</a> for the technical detail.</p>
    </section>
  );
}
