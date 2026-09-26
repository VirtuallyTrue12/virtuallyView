import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { SvgIcon, type IconName } from './SvgIcon';

const CloseMenu = createContext<() => void>(() => undefined);

/** A "more" button that opens a small list of less-used actions, so the page keeps only what matters up front. */
export function MoreMenu({ label = 'More options', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLElement>('.more-trigger')?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]!.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <div className="more" ref={root}>
      <button type="button" className="btn btn-secondary more-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} aria-label={label} title={label}>
        <SvgIcon name="more" size={20} />
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label={label}>
          <CloseMenu.Provider value={() => setOpen(false)}>{children}</CloseMenu.Provider>
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, label, hint, onSelect, danger, disabled }: { icon?: IconName; label: string; hint?: string; onSelect: () => void; danger?: boolean; disabled?: boolean }) {
  const close = useContext(CloseMenu);
  return (
    <button type="button" role="menuitem" className={`more-item${danger ? ' is-danger' : ''}`} disabled={disabled} onClick={() => { close(); onSelect(); }}>
      {icon && <SvgIcon name={icon} size={17} />}
      <span className="more-item-text"><span>{label}</span>{hint && <span className="more-item-hint">{hint}</span>}</span>
    </button>
  );
}

export const MenuDivider = () => <div className="more-divider" role="separator" />;
