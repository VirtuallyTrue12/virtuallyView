import { useEffect } from 'react';

/** While a film or episode page is open, the site menus step aside so the picture fills the window. */
export function useWatchingBody(): void {
  useEffect(() => {
    document.body.classList.add('is-watching');
    return () => document.body.classList.remove('is-watching');
  }, []);
}
