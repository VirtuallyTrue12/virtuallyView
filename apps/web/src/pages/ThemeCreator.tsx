import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackButton } from '../components/layout/BackButton';
import { ThemePreview } from '../components/settings/ThemePreview';
import { api } from '../lib/api';
import { FONTS, START, buildTokens, tokensToVars, type CreatorChoices } from '../lib/theme-tokens';

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// Starting points so a new theme does not begin from a blank slate.
const PRESETS: Array<{ label: string; choices: Partial<CreatorChoices> }> = [
  { label: 'Cinema night', choices: { mode: 'dark', background: '#0b0c14', text: '#eef0f6', accent: '#d4a24e', backdrop: 'accent-glow' } },
  { label: 'Daylight', choices: { mode: 'light', background: '#f3f4f8', text: '#161a26', accent: '#b8740f', depth: 'soft', backdrop: 'none', blur: 12 } },
  { label: 'Neon', choices: { mode: 'dark', background: '#07070c', text: '#f4f1ff', accent: '#ff2e97', buttons: 'square', uppercaseButtons: true, glow: true, roundness: 3, font: 'mono' } },
  { label: 'Ink & paper', choices: { mode: 'light', background: '#f1e9d8', text: '#2b2118', accent: '#8a3b12', font: 'serif', roundness: 4, buttons: 'square', depth: 'flat', blur: 0, backdrop: 'none' } }
];

export default function ThemeCreator() {
  const navigate = useNavigate();
  const [c, setC] = useState<CreatorChoices>(START);
  const [name, setName] = useState('My theme');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof CreatorChoices>(key: K, value: CreatorChoices[K]) => setC(prev => ({ ...prev, [key]: value }));
  const tokens = useMemo(() => buildTokens(c), [c]);
  const vars = useMemo(() => tokensToVars(tokens), [tokens]);
  const id = slug(name) || 'my-theme';

  const manifest = () => ({
    name: name.trim() || 'My theme', id, version: '1.0.0', author: 'You',
    description: description.trim() || 'A custom theme.', engine: '1.x', license: 'MIT',
    categories: [c.mode, 'custom']
  });

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await api.importTheme(manifest(), tokens);
      navigate('/themes');
    } catch (err) {
      setNote({ tone: 'err', text: `${(err as Error).message} (Only administrators can save themes to the server; you can still download the file.)` });
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({ theme: manifest(), tokens }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const color = (label: string, key: 'background' | 'text' | 'accent') => (
    <label className="creator-field creator-field--color">
      <span>{label}</span>
      <input type="color" value={c[key]} onChange={e => set(key, e.target.value)} aria-label={label} />
      <code>{c[key]}</code>
    </label>
  );

  return (
    <main className="page creator">
      <BackButton to="/themes" label="Appearance" />
      <div className="page-head"><h1>Create a theme</h1></div>

      <div className="creator-layout">
        <div className="creator-controls">
          <section className="settings-section">
            <h3 className="section-title">Start from</h3>
            <div className="requests-filters">
              {PRESETS.map(p => <button key={p.label} type="button" className="season-tab" onClick={() => setC(prev => ({ ...prev, ...p.choices }))}>{p.label}</button>)}
            </div>
          </section>

          <section className="settings-section">
            <h3 className="section-title">Basics</h3>
            <label className="creator-field"><span>Name</span><input className="settings-input" value={name} onChange={e => setName(e.target.value)} maxLength={40} /></label>
            <label className="creator-field"><span>Description</span><input className="settings-input" value={description} onChange={e => setDescription(e.target.value)} maxLength={140} placeholder="What it looks like" /></label>
            <div className="creator-field"><span>Brightness</span>
              <div className="requests-filters">
                {(['dark', 'light'] as const).map(m => <button key={m} type="button" className={`season-tab${c.mode === m ? ' is-active' : ''}`} onClick={() => set('mode', m)}>{m === 'dark' ? 'Dark' : 'Light'}</button>)}
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="section-title">Colors</h3>
            {color('Background', 'background')}
            {color('Text', 'text')}
            {color('Accent', 'accent')}
            <p className="model-suggest-meta">Card, border and muted-text colors are worked out from these three.</p>
          </section>

          <section className="settings-section">
            <h3 className="section-title">Shape and type</h3>
            <label className="creator-field"><span>Corner roundness ({c.roundness}px)</span><input type="range" min={0} max={28} value={c.roundness} onChange={e => set('roundness', Number(e.target.value))} /></label>
            <div className="creator-field"><span>Buttons</span>
              <div className="requests-filters">
                {(['square', 'rounded', 'pill'] as const).map(b => <button key={b} type="button" className={`season-tab${c.buttons === b ? ' is-active' : ''}`} onClick={() => set('buttons', b)}>{b[0]!.toUpperCase() + b.slice(1)}</button>)}
                <label className="creator-check"><input type="checkbox" checked={c.uppercaseButtons} onChange={e => set('uppercaseButtons', e.target.checked)} /> UPPERCASE</label>
              </div>
            </div>
            <div className="creator-field"><span>Font</span>
              <div className="requests-filters">
                {(Object.keys(FONTS) as Array<keyof typeof FONTS>).map(f => <button key={f} type="button" className={`season-tab${c.font === f ? ' is-active' : ''}`} onClick={() => set('font', f)}>{FONTS[f].label}</button>)}
              </div>
            </div>
            <label className="creator-field"><span>Heading weight ({c.headingWeight})</span><input type="range" min={400} max={800} step={50} value={c.headingWeight} onChange={e => set('headingWeight', Number(e.target.value))} /></label>
          </section>

          <section className="settings-section">
            <h3 className="section-title">Depth and background</h3>
            <div className="creator-field"><span>Shadows</span>
              <div className="requests-filters">
                {(['flat', 'soft', 'strong'] as const).map(d => <button key={d} type="button" className={`season-tab${c.depth === d ? ' is-active' : ''}`} onClick={() => set('depth', d)}>{d[0]!.toUpperCase() + d.slice(1)}</button>)}
                <label className="creator-check"><input type="checkbox" checked={c.glow} onChange={e => set('glow', e.target.checked)} /> Accent glow</label>
              </div>
            </div>
            <label className="creator-field"><span>Frosted glass ({c.blur}px blur)</span><input type="range" min={0} max={40} value={c.blur} onChange={e => set('blur', Number(e.target.value))} /></label>
            <div className="creator-field"><span>Background</span>
              <div className="requests-filters">
                {([['none', 'Plain'], ['accent-glow', 'Accent glow'], ['aurora', 'Aurora']] as const).map(([k, l]) => <button key={k} type="button" className={`season-tab${c.backdrop === k ? ' is-active' : ''}`} onClick={() => set('backdrop', k)}>{l}</button>)}
              </div>
            </div>
            <div className="creator-field"><span>Poster hover</span>
              <div className="requests-filters">
                {([['none', 'None'], ['lift', 'Lift'], ['zoom', 'Zoom']] as const).map(([k, l]) => <button key={k} type="button" className={`season-tab${c.hover === k ? ' is-active' : ''}`} onClick={() => set('hover', k)}>{l}</button>)}
              </div>
            </div>
          </section>
        </div>

        <aside className="creator-preview">
          <div className="creator-sticky">
            <div className="theme-tile"><ThemePreview vars={vars} name={name || 'My theme'} /></div>
            {note && <div className={`notice notice--${note.tone}`} role="status">{note.text}</div>}
            <div className="theme-tile-actions">
              <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save theme'}</button>
              <button className="btn btn-secondary" type="button" onClick={download}>Download file</button>
            </div>
            <p className="model-suggest-meta">Saved themes appear on the Appearance page, where you pick them per device. Download a file to share a theme; others can import it there.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
