import type { Rail } from '../../lib/api';
import { SvgIcon } from '../ui/SvgIcon';
import './PersonalRails.css';

interface Props {
  /** Every rail on the home page, in order, hidden ones included. */
  rails: Rail[];
  /** Called with the new order and hidden flags after each change. */
  onSave: (rails: Rail[]) => void;
  onReset: () => void;
  onDone: () => void;
  error: string | null;
}

/** A plain list: move each rail up or down, show or hide it, or go back to the default. */
export function HomeLayoutEditor({ rails, onSave, onReset, onDone, error }: Props) {
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rails.length) return;
    const next = [...rails];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onSave(next);
  };

  const toggle = (index: number) => {
    onSave(rails.map((rail, i) => (i === index ? { ...rail, hidden: !rail.hidden } : rail)));
  };

  return (
    <div className="home-editor">
      <p className="dlg-help">Move rails up or down, or switch off the ones you do not want on your home page.</p>
      <ol className="home-editor-list">
        {rails.map((rail, index) => (
          <li key={rail.id} className={`home-editor-row${rail.hidden ? ' is-hidden' : ''}`}>
            <span className="home-editor-title">
              {rail.title}
              {rail.hidden && <span className="home-editor-note"> (hidden)</span>}
            </span>
            <div className="home-editor-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm home-editor-move"
                aria-label={`Move ${rail.title} up`}
                title="Move up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <SvgIcon name="chevron-up" size={14} />
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm home-editor-move"
                aria-label={`Move ${rail.title} down`}
                title="Move down"
                disabled={index === rails.length - 1}
                onClick={() => move(index, 1)}
              >
                <SvgIcon name="chevron-down" size={14} />
              </button>
              <button
                type="button"
                role="switch"
                className="home-switch"
                aria-checked={!rail.hidden}
                aria-label={`Show ${rail.title} on home`}
                onClick={() => toggle(index)}
              >
                <span className="home-switch-knob" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {error && <div className="notice notice--err" role="alert">{error}</div>}
      <div className="dlg-actions">
        <button type="button" className="btn btn-primary" onClick={onDone}>Done</button>
        <button type="button" className="btn btn-secondary" onClick={onReset}>Reset to default</button>
      </div>
    </div>
  );
}
