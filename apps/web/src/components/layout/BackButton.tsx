import { useNavigate } from 'react-router-dom';
import { SvgIcon } from '../ui/SvgIcon';

/**
 * Global back button: goes back in history when there is somewhere to go,
 * otherwise falls back to a page-level destination so it never dead-ends in a
 * deep-linked session.
 */
export function BackButton({ to, label = 'Back', exact = false }: { to: string; label?: string; exact?: boolean }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="back-btn"
      onClick={() => {
        // A button that names a place ("Movies") goes there; only a plain "Back" steps back through history,
        // which after the player would land on the player again.
        if (!exact && label === 'Back' && window.history.length > 1) navigate(-1);
        else navigate(to);
      }}
    >
      <span className="back-btn-arrow" aria-hidden="true"><SvgIcon name="arrow-left" size={16} /></span>
      {label}
    </button>
  );
}