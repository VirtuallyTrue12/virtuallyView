import { useCallback, useEffect, useRef, useState } from 'react';
import { BackButton } from '../components/layout/BackButton';

// Kept local because diagnostics is a deliberately narrow, safe response DTO.
interface Observation {
  id: string;
  label: string;
  status: 'passed' | 'warning' | 'failed' | 'not_checked';
  summary: string;
  recovery: string[];
}
interface DiagnosticsReport {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  timeoutMs: number;
  status: 'attention' | 'not_checked' | 'partial' | 'checked';
  counts: {
    supported: number; configured: number; supportedConfigured: number; unsupportedConfigured: number;
    enabled: number; checked: number; online: number; failed: number; disabled: number; notConfigured: number;
  };
  configuration: { status: string; checkedAt: string; durationMs: number; summary: string; recovery: string[] };
  services: Array<{
    adapter: string; name: string; configured: boolean; enabled: boolean; status: string;
    checkedAt: string | null; durationMs: number | null; summary: string; recovery: string[];
    observations: Observation[];
  }>;
  limitations: string[];
}
const statusLabels: Record<string, string> = {
  attention: 'Needs attention', not_checked: 'Not checked', partial: 'Some checks unavailable',
  checked: 'Live checks completed', online: 'Online', offline: 'Check failed', timeout: 'Timed out',
  setup_required: 'Setup required', disabled: 'Disabled', not_configured: 'Not configured',
  invalid_config: 'Invalid configuration', unknown: 'Unknown', passed: 'Observed', warning: 'Warning', failed: 'Failed'
};
const label = (status: string) => statusLabels[status] ?? status.replaceAll('_', ' ');
const time = (value: string) => new Date(value).toLocaleString();

function safeReport(report: DiagnosticsReport) {
  // Explicit fields only: never copy arbitrary server objects or error bodies.
  return [
    'VirtuallyView Diagnostics · read-only observations',
    `Started: ${report.startedAt}`, `Completed: ${report.completedAt}`,
    `Report duration: ${report.durationMs} ms; adapter check deadline: ${report.timeoutMs} ms`,
    `Summary: ${label(report.status)}`,
    `Supported adapters: ${report.counts.supported}; saved configurations: ${report.counts.configured}; unsupported saved entries: ${report.counts.unsupportedConfigured}`,
    `Probed: ${report.counts.checked}; online: ${report.counts.online}; failed/setup/config issues: ${report.counts.failed}; disabled: ${report.counts.disabled}`,
    '', `Configuration: ${report.configuration.summary}`, ...report.configuration.recovery.map(step => `  Next: ${step}`),
    '', ...report.services.flatMap(service => [
      `${service.name}: ${label(service.status)} (${service.durationMs === null ? 'not probed' : `${service.durationMs} ms`}; ${service.checkedAt ?? 'no check timestamp'})`,
      `  ${service.summary}`, ...service.recovery.map(step => `  Next: ${step}`),
      ...service.observations.flatMap(check => [
        `  ${check.label}: ${label(check.status)} · ${check.summary}`, ...check.recovery.map(step => `    Next: ${step}`)
      ])
    ]), '', 'Scope and privacy:', ...report.limitations
  ].join('\n');
}

function Recovery({ steps }: { steps: string[] }) {
  if (!steps.length) return null;
  return <div className="diagnostics-recovery"><strong>Next steps</strong><ul>{steps.map(step => <li key={step}>{step}</li>)}</ul></div>;
}

export default function Diagnostics() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [manualReport, setManualReport] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setError(''); setCopyStatus(''); setManualReport('');
    let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; request.abort(); }, 30000);
    try {
      const response = await fetch('/api/diagnostics', { signal: request.signal, credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        // Do not display arbitrary error bodies; they can contain upstream secrets.
        throw new Error(response.status === 401 ? 'Sign in to run diagnostics, then retry.'
          : response.status === 429 ? 'Too many requests. Wait a minute, then retry.'
          : 'Diagnostics could not be loaded. Check the dashboard connection and retry.');
      }
      const next: DiagnosticsReport = await response.json();
      if (!next || !Array.isArray(next.services) || !next.configuration || !next.counts || !Array.isArray(next.limitations)) {
        throw new Error('The diagnostics response was invalid. Retry or check the server deployment.');
      }
      if (mounted.current && controller.current === request) setReport(next);
    } catch (cause) {
      if (mounted.current && controller.current === request && (!request.signal.aborted || timedOut)) {
        setError(timedOut ? 'Diagnostics took too long. Retry when the dashboard server is reachable.'
          : cause instanceof Error && cause.message.startsWith('Sign in') ? cause.message
          : cause instanceof Error && cause.message.startsWith('Too many requests') ? cause.message
          : 'Diagnostics could not be loaded. Check the dashboard connection and retry.');
      }
    } finally {
      window.clearTimeout(deadline);
      if (mounted.current && controller.current === request) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [refresh]);

  const copyReport = async () => {
    if (!report) return;
    const text = safeReport(report);
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current) { setCopyStatus('Report copied.'); setManualReport(''); }
    } catch {
      if (mounted.current) {
        setCopyStatus('Clipboard unavailable. Select and copy the report below.');
        setManualReport(text);
      }
    }
  };

  return (
    <main className="page diagnostics-page">
      <BackButton to="/" label="Home" />
      <style>{`
        .diagnostics-page .page-head { flex-wrap: wrap; gap: 12px; }
        .diagnostics-page .page-head-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .diagnostics-page .diagnostics-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); }
        .diagnostics-page .diagnostics-card { min-width: 0; overflow-wrap: anywhere; }
        .diagnostics-page .diagnostics-card h2 { font-size: 1.1rem; margin: 0 0 12px; }
        .diagnostics-page .diagnostics-card h3 { margin: 16px 0 6px; }
        .diagnostics-page .diagnostics-row { gap: 16px; align-items: start; }
        .diagnostics-page .diagnostics-value { text-align: right; }
        .diagnostics-page p { line-height: 1.6; }
        .diagnostics-page .diagnostics-recovery { margin-top: 12px; font-size: .9rem; line-height: 1.6; }
        .diagnostics-page ul { padding-left: 20px; }
        .diagnostics-page .diagnostics-note { color: var(--color-text-secondary); font-size: .9rem; }
        .diagnostics-page .diagnostics-banner { padding: 16px; border: 1px solid var(--color-border); border-radius: 12px; margin-bottom: 20px; }
        .diagnostics-page .diagnostics-observation { border-top: 1px solid var(--color-border); margin-top: 16px; }
        .diagnostics-page .diagnostics-manual { display: block; box-sizing: border-box; width: 100%; min-height: 240px; margin: 12px 0 24px; }
        .diagnostics-page button:focus-visible, .diagnostics-page a:focus-visible, .diagnostics-page textarea:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
        @media (max-width: 480px) { .diagnostics-page .page-head-actions { width: 100%; } .diagnostics-page .page-head-actions button { flex: 1; min-height: 44px; } }
      `}</style>
      <div className="page-head">
        <h1>Diagnostics</h1>
        <div className="page-head-actions">
          <button className="btn btn-primary btn-sm" type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Checking…' : error ? 'Retry checks' : 'Refresh checks'}
          </button>
          <button className="btn btn-sm" type="button" onClick={() => void copyReport()} disabled={!report || loading}>
            Copy safe report
          </button>
        </div>
      </div>
      <p>Live, read-only service checks. No settings are changed and no repair actions are run. <a href="/settings">Manage integrations in Settings</a>.</p>
      <div role="status" aria-live="polite">{loading ? 'Running diagnostics. This may take a few seconds.' : copyStatus}</div>
      {error && <div role="alert" className="diagnostics-banner">{error}{report && ' The previous report remains below; it is not a fresh result.'}</div>}
      {manualReport && <div><label htmlFor="diagnostics-report">Safe report for manual copying</label>
        <textarea id="diagnostics-report" className="diagnostics-manual" readOnly value={manualReport} onFocus={event => event.currentTarget.select()} />
      </div>}
      {report && <section aria-label="Diagnostic results" aria-busy={loading}>
        <div className="diagnostics-banner">
          <strong>{label(report.status)}</strong>
          <p>Last completed: <time dateTime={report.completedAt}>{time(report.completedAt)}</time> · {report.durationMs} ms total</p>
          <p className="diagnostics-note">{report.counts.online} of {report.counts.checked} probed services passed their adapter health check.
            {report.counts.checked === 0 && ' No live service checks completed; service health is not established.'}
            {loading && ' Refresh in progress; showing the previous report.'}</p>
        </div>
        <div className="diagnostics-grid">
          <article className="diagnostics-card">
            <h2>Coverage</h2>
            {([
              ['Supported adapters', report.counts.supported], ['Saved configurations', report.counts.configured],
              ['Configured supported adapters', report.counts.supportedConfigured], ['Enabled supported adapters', report.counts.enabled],
              ['Online', report.counts.online], ['Failed / setup / config issues', report.counts.failed],
              ['Disabled', report.counts.disabled], ['Not configured', report.counts.notConfigured],
              ['Unsupported saved entries', report.counts.unsupportedConfigured]
            ] as const).map(([key, value]) => <div className="diagnostics-row" key={key}><span className="diagnostics-key">{key}</span><span className="diagnostics-value">{value}</span></div>)}
            {report.counts.unsupportedConfigured > 0 && <p>Unsupported saved entries were not probed. Review them in the server configuration; they do not count as connected services.</p>}
          </article>
          <article className="diagnostics-card">
            <h2>Saved configuration</h2>
            <p>{report.configuration.summary}</p>
            <p className="diagnostics-note"><time dateTime={report.configuration.checkedAt}>{time(report.configuration.checkedAt)}</time> · {report.configuration.durationMs} ms</p>
            <Recovery steps={report.configuration.recovery} />
          </article>
          {report.services.map(service => <article className="diagnostics-card" key={service.adapter}>
            <h2>{service.name} · {label(service.status)}</h2>
            <p>{service.summary}</p>
            <p className="diagnostics-note">{service.checkedAt ? <><time dateTime={service.checkedAt}>{time(service.checkedAt)}</time> · {service.durationMs} ms</> : 'No live probe performed.'}</p>
            <Recovery steps={service.recovery} />
            {service.observations.map(check => <section className="diagnostics-observation" key={check.id} aria-label={`${service.name}: ${check.label}`}>
              <h3>{check.label} · {label(check.status)}</h3><p>{check.summary}</p><Recovery steps={check.recovery} />
            </section>)}
          </article>)}
        </div>
        <section className="diagnostics-banner" style={{ marginTop: 20 }} aria-labelledby="diagnostics-scope">
          <h2 id="diagnostics-scope">Scope and privacy</h2>
          <ul>{report.limitations.map(note => <li key={note}>{note}</li>)}</ul>
        </section>
      </section>}
    </main>
  );
}
