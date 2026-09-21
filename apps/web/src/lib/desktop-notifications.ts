const KEY = 'vv-desktop-notifications';

export const desktopNotificationsEnabled = (): boolean => {
  try { return localStorage.getItem(KEY) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted'; } catch { return false; }
};

/** Turn desktop pop-ups on or off for this device; asks the browser for permission when enabling. */
export async function setDesktopNotifications(on: boolean): Promise<boolean> {
  try {
    if (on) {
      if (typeof Notification === 'undefined') return false;
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') { localStorage.setItem(KEY, '0'); return false; }
      localStorage.setItem(KEY, '1');
      return true;
    }
    localStorage.setItem(KEY, '0');
  } catch { /* storage or permission unavailable */ }
  return false;
}

export function showDesktopNotification(title: string, body: string, link: string): void {
  if (!desktopNotificationsEnabled()) return;
  try {
    const n = new Notification(title, { body, icon: '/favicon.svg', tag: `vv-${title}` });
    n.onclick = () => { window.focus(); if (link) window.location.assign(link); };
  } catch { /* the browser blocked it */ }
}
