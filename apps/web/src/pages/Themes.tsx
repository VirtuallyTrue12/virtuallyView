import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ThemeSummary } from '../lib/api';
import { effectiveMode, loadAppearance, saveAppearance, type Appearance } from '../lib/appearance';
import { BackButton } from '../components/layout/BackButton';
import { ModeSwitch } from '../components/settings/ModeSwitch';
import { ThemePreview } from '../components/settings/ThemePreview';

type Filter = 'all' | 'dark' | 'light';

export default function Themes() {
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance());
  const [filter, setFilter] = useState<Filter>('all');
  const [isAdmin, setIsAdmin] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => { api.themes().then(setThemes).catch(() => setThemes([])); }, []);
  useEffect(() => {
    load();
    api.authStatus().then(s => setIsAdmin(s.user?.role === 'admin')).catch(() => {});
    const sync = () => setAppearance(loadAppearance());
    window.addEventListener('vv-appearance', sync);
    return () => window.removeEventListener('vv-appearance', sync);
  }, [load]);

  const flash = (tone: 'ok' | 'err', text: string) => { setNote({ tone, text }); window.setTimeout(() => setNote(null), 4000); };

  const use = (theme: ThemeSummary) => {
    const a = loadAppearance();
    const next: Appearance = theme.mode === 'dark' ? { ...a, dark: theme.id } : { ...a, light: theme.id };
    // Choosing a theme shows it now: keep "System" only when the device already matches its brightness.
    if (a.mode !== 'system' || effectiveMode(a) !== theme.mode) next.mode = theme.mode;
    saveAppearance(next);
    setAppearance(next);
  };

  const makeDefault = async (theme: ThemeSummary) => {
    setBusy(theme.id);
    try { await api.activateTheme(theme.id); flash('ok', `${theme.name} is now the default for new devices.`); load(); }
    catch (err) { flash('err', (err as Error).message); }
    finally { setBusy(null); }
  };

  const remove = async (theme: ThemeSummary) => {
    setBusy(theme.id);
    try {
      await api.deleteTheme(theme.id);
      const a = loadAppearance();
      if (a.dark === theme.id || a.light === theme.id) saveAppearance({ ...a, dark: a.dark === theme.id ? 'default' : a.dark, light: a.light === theme.id ? 'light' : a.light });
      flash('ok', `${theme.name} was removed.`);
      load();
    } catch (err) { flash('err', (err as Error).message); }
    finally { setBusy(null); }
  };

  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(String(ev.target?.result)) as { theme?: unknown; tokens?: unknown };
        if (!data.theme || !data.tokens) throw new Error('Expected a file exported from the Theme Creator.');
        const res = await api.importTheme(data.theme, data.tokens);
        flash('ok', `${res.name} was added. Pick it below.`);
        load();
      } catch (err) { flash('err', (err as Error).message); }
    };
    reader.readAsText(file);
  };

  const shown = themes.filter(t => filter === 'all' || t.mode === filter);
  const darkName = themes.find(t => t.id === appearance.dark)?.name ?? appearance.dark;
  const lightName = themes.find(t => t.id === appearance.light)?.name ?? appearance.light;

  return (
    <main className="page appearance">
      <BackButton to="/" label="Home" />
      <div className="page-head">
        <div>
          <h1>Appearance</h1>
          <p className="search-hint">Each device keeps its own look. Pick a mode, then a theme for it.</p>
        </div>
        <div className="page-head-actions">
          {isAdmin && (
            <>
              <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => importRef.current?.click()}>Import theme</button>
            </>
          )}
          <Link className="btn btn-primary btn-sm" to="/themes/create">Create theme</Link>
        </div>
      </div>

      <section className="appearance-mode">
        <ModeSwitch />
        <p className="model-suggest-meta">
          Dark uses <strong>{darkName}</strong>, light uses <strong>{lightName}</strong>. "System" switches between them with your device.
        </p>
      </section>

      {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}

      <div className="requests-filters" role="tablist" aria-label="Theme brightness">
        {(['all', 'dark', 'light'] as Filter[]).map(f => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={`season-tab${filter === f ? ' is-active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? `All (${themes.length})` : f === 'dark' ? 'Dark' : 'Light'}
          </button>
        ))}
      </div>

      <div className="theme-gallery">
        {shown.map(theme => {
          const inUse = theme.id === appearance.dark || theme.id === appearance.light;
          return (
            <article className={`theme-tile${inUse ? ' is-active' : ''}`} key={theme.id}>
              <ThemePreview vars={theme.cssVars} name={theme.name} />
              <div className="theme-tile-body">
                <div className="theme-tile-head">
                  <h3>{theme.name}</h3>
                  <span className="theme-badges">
                    <span className="theme-badge">{theme.mode === 'dark' ? 'Dark' : 'Light'}</span>
                    {theme.id === appearance.dark && <span className="theme-badge theme-badge--on">Dark theme</span>}
                    {theme.id === appearance.light && <span className="theme-badge theme-badge--on">Light theme</span>}
                    {theme.active && <span className="theme-badge">Server default</span>}
                  </span>
                </div>
                <p>{theme.description}</p>
                <div className="theme-tile-actions">
                  <button className="btn btn-primary btn-sm" type="button" disabled={inUse && effectiveMode(appearance) === theme.mode && (theme.id === (theme.mode === 'dark' ? appearance.dark : appearance.light))} onClick={() => use(theme)}>
                    {inUse ? 'Use now' : 'Use'}
                  </button>
                  {isAdmin && !theme.active && <button className="btn btn-secondary btn-sm" type="button" disabled={busy === theme.id} onClick={() => void makeDefault(theme)}>Set as default</button>}
                  {isAdmin && theme.custom && <button className="btn btn-secondary btn-sm" type="button" disabled={busy === theme.id} onClick={() => void remove(theme)}>Remove</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
