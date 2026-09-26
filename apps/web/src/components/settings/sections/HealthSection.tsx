import { useEffect, useState } from 'react';
import { api, type ServerSettings } from '../../../lib/api';
import { Troubleshooter } from '../Troubleshooter';
import { FixEverything } from '../FixEverything';
import { Link } from 'react-router-dom';
import { Pill } from '../../ui/Page';

/** "Something is not working": the same checks as the Apps page, plus a quick self-test of this server. */
export default function HealthSection({ settings, onSaved }: { settings?: ServerSettings | null; onSaved?: (s: ServerSettings) => void }) {
  const [round, setRound] = useState(0);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api.health().then(h => setCheck({ ok: h.status === 'ok', text: h.status === 'ok' ? `The server is answering (version ${h.version}).` : `The server answered with "${h.status}".` }))
      .catch(err => setCheck({ ok: false, text: `The server is not reachable: ${(err as Error).message}` }));
  }, []);
  return (
    <div className="st-block">
      <div className="st-status-line">{check && <Pill tone={check.ok ? 'ok' : 'bad'}>{check.ok ? 'Server OK' : 'Server problem'}</Pill>}<span className="ui-help">{check?.text ?? 'Checking the server…'}</span></div>
      <FixEverything settings={settings} onSaved={onSaved} onDone={() => setRound(r => r + 1)} />
      <Troubleshooter key={round} />
      <p className="ui-help">Need the technical detail? Open <Link to="/diagnostics">Diagnostics</Link>.</p>
    </div>
  );
}
