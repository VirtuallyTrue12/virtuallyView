import React from 'react';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <div className="theme-provider">{children}</div>;
}
