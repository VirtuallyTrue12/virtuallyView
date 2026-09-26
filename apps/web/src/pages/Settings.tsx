import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type ServerSettings } from '../lib/api';
import { PageHeader } from '../components/ui/Page';
import { SvgIcon } from '../components/ui/SvgIcon';
import { LEGACY, SEARCH_INDEX, SECTIONS, type SectionId } from '../components/settings/settings-index';
import SettingsHome from '../components/settings/SettingsHome';
import ServicesSection from '../components/settings/sections/ServicesSection';
import FoldersSection from '../components/settings/sections/FoldersSection';
import NetworkSection from '../components/settings/sections/NetworkSection';
import AiSection from '../components/settings/sections/AiSection';
import ServerSection from '../components/settings/sections/ServerSection';
import AppearanceSection from '../components/settings/sections/AppearanceSection';
import HealthSection from '../components/settings/sections/HealthSection';
import UsersPanel from '../components/settings/UsersPanel';
import DefaultQuality from '../components/settings/DefaultQuality';
import RequestRules from '../components/settings/RequestRules';
import IndexersPanel from '../components/settings/IndexersPanel';
import BackupPanel from '../components/settings/BackupPanel';
import NotificationsPanel from '../components/settings/NotificationsPanel';

const isSection = (v: string | null): v is SectionId => SECTIONS.some(s => s.id === v);

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('s') ?? params.get('cat');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [version, setVersion] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.authStatus().then(st => setIsAdmin(st.user?.role === 'admin' || !st.enabled)).catch(() => setIsAdmin(false));
    api.serverSettings().then(setSettings).catch(() => {});
    fetch('/api/health').then(r => r.json()).then((h: { version?: string }) => setVersion(h.version ?? '')).catch(() => undefined);
  }, []);

  const visible = useMemo(() => SECTIONS.filter(s => isAdmin !== false || !s.adminOnly), [isAdmin]);
  const current: SectionId = (() => {
    const mapped = wanted && (LEGACY[wanted] ?? wanted);
    if (mapped && isSection(mapped) && visible.some(s => s.id === mapped)) return mapped;
    return visible[0]?.id ?? 'appearance';
  })();
  const info = SECTIONS.find(s => s.id === current)!;

  const go = (id: SectionId) => { setQuery(''); setParams(id === 'home' ? {} : { s: id }, { replace: false }); window.scrollTo({ top: 0 }); };

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    return SEARCH_INDEX.filter(e => visible.some(s => s.id === e.section) && words.every(w => `${e.label} ${e.words}`.toLowerCase().includes(w))).slice(0, 8);
  }, [query, visible]);

  const groups = [...new Set(visible.map(s => s.group))];

  return (
    <main className="page st-page">
      <PageHeader
        title="Settings"
        sub={info.id === 'home' ? 'Everything about your server, in one place' : info.blurb}
        actions={
          <div className="st-search">
            <SvgIcon name="search" size={16} />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a setting…" aria-label="Find a setting" />
          </div>
        }
      />
      <div className="st">
        <nav className="st-nav" aria-label="Settings sections">
          {groups.map(g => (
            <div className="st-nav-group" key={g}>
              <span className="st-nav-label">{g}</span>
              {visible.filter(s => s.group === g).map(s => (
                <button key={s.id} type="button" className={`st-nav-item${current === s.id && !query ? ' is-active' : ''}`} aria-current={current === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
                  <SvgIcon name={s.icon} size={17} /><span>{s.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="st-body">
          {query.trim().length >= 2 ? (
            <div className="st-results" role="region" aria-label="Search results">
              <h2 className="ui-section-title">{hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : `Nothing matches "${query}"`}</h2>
              {hits.length === 0 && <p className="ui-help">Try a simpler word, like "backup", "password", "folder" or "quality".</p>}
              <ul className="st-hits">
                {hits.map(h => {
                  const s = SECTIONS.find(x => x.id === h.section)!;
                  return <li key={h.label}><button type="button" onClick={() => go(h.section)}><SvgIcon name={s.icon} size={18} /><span><strong>{h.label}</strong><em>{s.label}</em></span><SvgIcon name="chevron-right" size={16} /></button></li>;
                })}
              </ul>
            </div>
          ) : (
            <>
              {current !== 'home' && <h2 className="st-title">{info.label}</h2>}
              {current === 'home' && <SettingsHome go={go} />}
              {current === 'library' && (<><FoldersSection settings={settings} onSaved={setSettings} /><DefaultQuality settings={settings} onSaved={setSettings} /></>)}
              {current === 'sources' && <IndexersPanel />}
              {current === 'services' && <ServicesSection />}
              {current === 'people' && (<><UsersPanel /><RequestRules settings={settings} onSaved={setSettings} /></>)}
              {current === 'notifications' && <NotificationsPanel settings={settings} onSaved={setSettings} />}
              {current === 'appearance' && <AppearanceSection />}
              {current === 'network' && <NetworkSection settings={settings} onSaved={setSettings} />}
              {current === 'backup' && <BackupPanel settings={settings} onSaved={setSettings} />}
              {current === 'ai' && <AiSection />}
              {current === 'health' && <HealthSection />}
              {current === 'server' && <ServerSection settings={settings} onSaved={setSettings} version={version} />}
              {isAdmin === false && <p className="ui-help">More settings are available to administrators. Your own profile is under <Link to="/account">Account</Link>.</p>}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
