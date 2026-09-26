import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SvgIcon, type IconName } from './SvgIcon';

const CloseMenu = createContext<() => void>(() => undefined);

/**
 * A "more" button that opens a small list of less-used actions, so the page keeps only what matters up front.
 * The list is drawn above the page (not inside the row), so a card or hero that clips its contents never cuts it off,
 * and it opens upward when there is no room below. On a phone it is a sheet above the tab bar.
 */
export function MoreMenu({ label = 'More options', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; origin: string } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const phone = () => typeof window !== 'undefined' && window.innerWidth <= 640;

  const reposition = useCallback(() => {
    const t = trigger.current, m = menu.current;
    if (!t || !m || phone()) return;
    const r = t.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    const below = window.innerHeight - r.bottom, above = r.top;
    const up = below < h + 16 && above > below;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const top = up ? Math.max(8, r.top - h - 8) : Math.min(r.bottom + 8, window.innerHeight - h - 8);
    setPlace({ top, left, origin: `${up ? 'bottom' : 'top'} right` });
  }, []);

  useLayoutEffect(() => { if (open) reposition(); else setPlace(null); }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!menu.current?.contains(n) && !trigger.current?.contains(n)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]!.focus();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [open, reposition]);

  return (
    <div className="more">
      <button ref={trigger} type="button" className="btn btn-secondary more-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} aria-label={label} title={label}>
        <SvgIcon name="more" size={22} />
      </button>
      {open && createPortal(
        <div ref={menu} className={`more-menu more-menu--portal${place || phone() ? '' : ' is-measuring'}`} role="menu" aria-label={label}
          style={place && !phone() ? { top: place.top, left: place.left, transformOrigin: place.origin } : undefined}>
          <CloseMenu.Provider value={() => setOpen(false)}>{children}</CloseMenu.Provider>
        </div>,
        document.body
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
