import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ThemeSummary } from '../../../lib/api';
import { ModeSwitch } from '../ModeSwitch';
import { SvgIcon } from '../../ui/SvgIcon';

export default function AppearanceSection() {
  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  useEffect(() => { api.themes().then(setThemes).catch(() => setThemes([])); }, []);
  const active = themes.find(t => t.active);
  return (
    <div className="st-block">
      <div className="settings-section">
        <h3 className="section-title">Light or dark</h3>
        <p className="ui-help">Applies to this device only. Each mode uses the theme you pick for it.</p>
        <ModeSwitch />
      </div>
      <div className="settings-section">
        <h3 className="section-title">Theme</h3>
        <p className="ui-help">Server default: {active?.name ?? 'Default'}. Each device can choose its own look; you can also make your own or import one.</p>
        <div className="st-connect-actions">
          <Link className="btn btn-primary btn-sm" to="/themes"><SvgIcon name="palette" size={15} /> Browse themes</Link>
          <Link className="btn btn-secondary btn-sm" to="/themes/create"><SvgIcon name="edit" size={15} /> Make your own</Link>
        </div>
      </div>
    </div>
  );
}
