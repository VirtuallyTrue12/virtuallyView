import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { SvgIcon, type IconName } from './SvgIcon';
import '../../ui-kit.css';

/** The header every page opens with: big title, one quiet line, and the few actions people come for. */
export function PageHeader({ title, sub, actions, icon }: { title: string; sub?: ReactNode; actions?: ReactNode; icon?: IconName }) {
  return (
    <header className="lib-head">
      <div className="lib-head-text">
        <h1>{icon && <SvgIcon name={icon} size={28} className="ph-icon" />}{title}</h1>
        {sub && <p className="lib-sub">{sub}</p>}
      </div>
      {actions && <div className="lib-actions">{actions}</div>}
    </header>
  );
}

/** A titled block of a page, with an optional line of help and a right-hand slot. */
export function Section({ title, help, aside, children, id }: { title?: string; help?: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="ui-section" id={id} aria-label={title}>
      {(title || aside) && (
        <div className="ui-section-head">
          <div>{title && <h2 className="ui-section-title">{title}</h2>}{help && <p className="ui-help">{help}</p>}</div>
          {aside && <div className="ui-section-aside">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ icon = 'sparkle', title, text, action }: { icon?: IconName; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon"><SvgIcon name={icon} size={26} /></span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

/** A row of choices where exactly one is on. Counts are optional. */
export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div className="seg ui-seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`seg-btn${value === o.value ? ' is-on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}{o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Links between sibling pages (Requests, Downloads, Search) so they read as one place. */
export function SubNav({ items, label }: { items: { to: string; label: string; icon?: IconName; badge?: number }[]; label: string }) {
  return (
    <nav className="ui-subnav" aria-label={label}>
      {items.map(i => (
        <NavLink key={i.to} to={i.to} end className={({ isActive }) => `ui-subnav-link${isActive ? ' is-active' : ''}`}>
          {i.icon && <SvgIcon name={i.icon} size={16} />}<span>{i.label}</span>{!!i.badge && <span className="ui-badge">{i.badge}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`ui-stat${tone ? ` ui-stat--${tone}` : ''}`}>
      <span className="ui-stat-label">{label}</span>
      <strong className="ui-stat-value">{value}</strong>
      {hint && <span className="ui-stat-hint">{hint}</span>}
    </div>
  );
}

/** A small coloured word: state at a glance. */
export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`ui-pill ui-pill--${tone}`}>{children}</span>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`ui-switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

/** One line of a form: what it is, what it does, then the control. */
export function Field({ label, help, children, htmlFor }: { label: string; help?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="ui-field">
      <div className="ui-field-text"><label htmlFor={htmlFor}>{label}</label>{help && <p className="ui-help">{help}</p>}</div>
      <div className="ui-field-control">{children}</div>
    </div>
  );
}
