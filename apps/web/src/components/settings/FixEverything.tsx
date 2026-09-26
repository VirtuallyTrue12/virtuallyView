import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ApiError, type FixJob, type FixStep, type ServerSettings } from '../../lib/api';
import { Switch } from '../ui/Page';

const ICON: Record<FixStep['status'], string> = { pending: '·', running: '', ok: '✓', fixed: '✓', failed: '!', 'needs-host': '!' };

function StepRow({ step }: { step: FixStep }) {
  return (
    <li className={`fx-step fx-step--${step.status}`}>
      <span className="fx-mark" aria-hidden="true">{step.status === 'running' ? <span className="fx-spin" /> : ICON[step.status]}</span>
      <span className="fx-text"><strong>{step.label}</strong>{step.message && <span>{step.message}</span>}</span>
    </li>
  );
}

/**
 * One button for "something is broken": the server starts what stopped, restarts what is stuck, reconnects the
 * apps and replaces dead downloads, and this shows each step as it happens. Only what needs the machine's owner
 * is left over, with the single command for it.
 */
export function FixEverything({ settings, onSaved, onDone }: { settings?: ServerSettings | null; onSaved?: (s: ServerSettings) => void; onDone?: () => void }) {
  const [job, setJob] = useState<FixJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const wasRunning = useRef(false);
  const running = !!job && !job.finishedAt;

  const poll = useCallback(async () => {
    try { setJob((await api.currentFix()).job); } catch { /* keep the last picture */ }
  }, []);
  useEffect(() => { void poll(); }, [poll]);
  useEffect(() => {
    if (!running) { if (wasRunning.current) { wasRunning.current = false; onDone?.(); } return; }
    wasRunning.current = true;
    const timer = window.setInterval(() => void poll(), 1500);
    return () => window.clearInterval(timer);
  }, [running, poll, onDone]);

  const start = async () => {
    setError(null); setCopied(false);
    try { setJob(await api.startFix()); } catch (err) {
      setError((err as ApiError).status === 403 ? 'Only an administrator can do this.' : err instanceof Error ? err.message : 'Could not start.');
    }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setError('Copy the command by hand: ' + text); }
  };

  const finished = !!job?.finishedAt;
  const clean = finished && job!.after === 0;
  const headline = running ? 'Working on it…'
    : !finished ? 'Fix problems in one press'
    : clean ? (job!.before ? `All ${job!.before} problem${job!.before === 1 ? '' : 's'} fixed.` : 'Nothing was wrong.')
    : `Fixed what it could. ${job!.after} thing${job!.after === 1 ? '' : 's'} left.`;

  return (
    <section className={`fx${clean ? ' is-clean' : ''}`} aria-label="Fix everything">
      <div className="fx-top">
        <div>
          <h2 className="fx-title">{headline}</h2>
          <p className="fx-sub">Starts what stopped, restarts what is stuck, reconnects the apps to each other and replaces dead downloads. Nothing you downloaded is touched.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={running}>{running ? 'Fixing…' : finished ? 'Fix again' : 'Fix everything'}</button>
      </div>
      {error && <div className="notice notice--err" role="alert">{error}</div>}
      {job && job.steps.length > 0 && <ol className="fx-steps" aria-live="polite">{job.steps.map(s => <StepRow key={s.id} step={s} />)}</ol>}
      {finished && job!.hostCommand && (
        <div className="fx-host">
          <p><strong>One thing needs the server itself.</strong> Open a terminal on the computer that runs virtuallyView, go to its folder and run this. It asks for your password only if it needs it, and fixes the rest by itself:</p>
          <div className="fx-cmd"><code>{job!.hostCommand}</code><button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(job!.hostCommand!)}>{copied ? 'Copied' : 'Copy'}</button></div>
        </div>
      )}
      {settings && onSaved && (
        <label className="fx-auto">
          <Switch checked={settings.autoRepair !== false} onChange={async v => { try { onSaved(await api.saveServerSettings({ autoRepair: v })); } catch (err) { setError((err as Error).message); } }} label="Start stopped services by themselves" />
          <span>Start stopped services by themselves (after a reboot or sleep)</span>
        </label>
      )}
    </section>
  );
}
