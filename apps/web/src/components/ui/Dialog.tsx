import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SvgIcon } from './SvgIcon';

/**
 * A modal panel: centred on a computer, a sheet from the bottom on a phone.
 * Escape and the backdrop close it, focus moves in and comes back, and the page
 * behind does not scroll.
 */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0]!, last = items[items.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = scroll;
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="dlg-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} tabIndex={-1} className={`dlg${wide ? ' dlg--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dlg-head">
          <h2 className="dlg-title">{title}</h2>
          <button type="button" className="mp-icon" onClick={onClose} aria-label="Close"><SvgIcon name="close" size={18} /></button>
        </header>
        <div className="dlg-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
