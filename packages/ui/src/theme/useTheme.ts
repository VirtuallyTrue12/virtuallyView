import { useState, useCallback } from 'react';

export function useTheme() {
  const [themeId, setThemeId] = useState('midnight');
  const activate = useCallback((id: string) => setThemeId(id), []);
  return { themeId, activate };
}
