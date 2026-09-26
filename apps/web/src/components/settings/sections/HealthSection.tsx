import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Troubleshooter } from '../Troubleshooter';
import { Link } from 'react-router-dom';
import { Pill } from '../../ui/Page';

/** "Something is not working": the same checks as the Apps page, plus a quick self-test of this server. */
export default function HealthSection() {
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api.health().then(h => setCheck({ ok: h.status === 'ok', text: h.status === 'ok' ? `The server is answering (version ${h.version}).` : `The server answered with "${h.status}".` }))
      .catch(err => setCheck({ ok: false, text: `The server is not reachable: ${(err as Error).message}` }));
  }, []);
  return (
    <div className="st-block">
      <div className="st-status-line">{check && <Pill tone={check.ok ? 'ok' : 'bad'}>{check.ok ? 'Server OK' : 'Server problem'}</Pill>}<span className="ui-help">{check?.text ?? 'Checking the server…'}</span></div>
      <Troubleshooter />
      <p className="ui-help">Need the technical detail? Open <Link to="/diagnostics">Diagnostics</Link>.</p>
    </div>
  );
}
