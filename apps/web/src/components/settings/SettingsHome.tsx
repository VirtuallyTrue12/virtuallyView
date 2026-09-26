import { useEffect, useState } from 'react';
import { api, type SettingsOverview } from '../../lib/api';
import { Pill } from '../ui/Page';
import { SvgIcon, type IconName } from '../ui/SvgIcon';
import type { SectionId } from './settings-index';

const TASKS: Array<{ section: SectionId; area?: string; icon: IconName; title: string; text: string }> = [
  { section: 'services', area: 'services', icon: 'server', title: 'Get downloads working', text: 'Connect the apps that find and fetch your media.' },
  { section: 'sources', area: 'sources', icon: 'search', title: 'Add places to search', text: 'Sources decide what can be found and downloaded.' },
  { section: 'people', area: 'people', icon: 'users', title: 'Invite someone', text: 'Accounts for family and friends, with age limits.' },
  { section: 'notifications', area: 'notifications', icon: 'bell', title: 'Get alerts', text: 'A message on your phone when something is ready.' },
  { section: 'network', area: 'network', icon: 'wifi', title: 'Connect a TV or phone', text: 'The address and sign-in for other devices.' },
  { section: 'backup', area: 'backup', icon: 'hdd', title: 'Back up my server', text: 'Save accounts, history and settings.' },
  { section: 'appearance', icon: 'palette', title: 'Change how it looks', text: 'Light or dark, and themes.' },
  { section: 'health', icon: 'wrench', title: 'Something is not working', text: 'Checks everything and tells you what to try.' }
];

const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = { ok: 'ok', warn: 'warn', bad: 'bad', off: 'neutral' };

/** The first thing people see: what is fine, what needs a look, and every common job one click away. */
export default function SettingsHome({ go }: { go: (s: SectionId) => void }) {
  const [data, setData] = useState<SettingsOverview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api.settingsOverview().then(setData).catch(() => setFailed(true)); }, []);

  const line = (area?: string) => data?.areas.find(a => a.id === area);
  const warn = data?.suggestions.filter(s => s.tone === 'warn').length ?? 0;
  const headline = !data ? 'Checking your server…' : warn ? `${warn} thing${warn === 1 ? '' : 's'} to look at` : 'Everything you need is set up';

  return (
    <div className="st-home">
      <div className={`st-hero${warn ? ' has-warn' : ''}`}>
        <span className="st-hero-icon"><SvgIcon name={warn ? 'alert' : 'check'} size={22} /></span>
        <div>
          <h2>{headline}</h2>
          <p>{failed ? 'The overview could not be loaded. The sections on the left still work.' : data ? `${data.serverName} is running. Pick a job below, or use the search box to find a setting.` : ' '}</p>
        </div>
      </div>

      {data && data.suggestions.length > 0 && (
        <section aria-label="Suggested next steps">
          <h3 className="st-h">Suggested next steps</h3>
          <ul className="st-suggest">
            {data.suggestions.map(s => (
              <li key={s.id} className={`st-suggest-item st-suggest-item--${s.tone}`}>
                <div><strong>{s.title}</strong><span>{s.detail}</span></div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(s.section as SectionId)}>Open <SvgIcon name="arrow-right" size={14} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="What do you want to do?">
        <h3 className="st-h">What do you want to do?</h3>
        <div className="st-tasks">
          {TASKS.map(t => {
            const a = line(t.area);
            return (
              <button type="button" key={t.title} className="st-task" onClick={() => go(t.section)}>
                <span className="st-task-icon"><SvgIcon name={t.icon} size={20} /></span>
                <span className="st-task-title">{t.title}</span>
                <span className="st-task-text">{t.text}</span>
                {a && <Pill tone={TONE[a.tone] ?? 'neutral'}>{a.line}</Pill>}
              </button>
            );
          })}
        </div>
      </section>

      {data && data.changes.length > 0 && (
        <section aria-label="Recent changes">
          <div className="st-h-row"><h3 className="st-h">Recent changes</h3><button type="button" className="mp-link" onClick={() => go('server')}>See all</button></div>
          <ul className="st-history">
            {data.changes.slice(0, 5).map(c => <li key={c.id}><span className="st-history-area">{c.area}</span><span className="st-history-text">{c.summary}</span><span className="st-history-meta">{c.actor} · {new Date(c.at).toLocaleString()}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
