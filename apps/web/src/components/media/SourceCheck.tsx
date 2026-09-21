import { useCallback, useState } from 'react';
import { api, type VerifyResult } from '../../lib/api';

export function SourceCheck({ id }: { id: string }) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.verifyMedia(id);
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  if (!result && !loading && !error) {
    return (
      <div className="source-check source-check--idle">
        <button className="btn btn-secondary btn-sm" type="button" onClick={run}>
          Check media sources
        </button>
      </div>
    );
  }

  return (
    <div className="source-check">
      <div className="source-check-head">
        <span className="source-check-title">Source check</span>
        <button className="btn btn-secondary btn-sm" type="button" onClick={run} disabled={loading}>
          {loading ? 'Checking...' : 'Re-check'}
        </button>
      </div>
      {error && <div className="notice notice--err">{error}</div>}
      {result && (
        <div className="source-check-list">
          <span className={`source-check-verdict${result.verified ? ' source-check-verdict--ok' : ' source-check-verdict--warn'}`}>
            {result.verified ? 'All sources reachable' : 'Some sources unreachable'}
          </span>
          {result.checks.map((c, i) => (
            <div className="source-check-row" key={i}>
              <span className={`source-dot${c.ok ? ' source-dot--ok' : ''}`} />
              <span className="source-check-name">{c.name}</span>
              <span className="source-check-detail">{c.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}