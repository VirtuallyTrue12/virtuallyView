import type { ReactNode } from 'react';

/** Rarely used settings and checks, folded away at the bottom of a page so they do not compete with what people came for. */
export function ManageSection({ title = 'Settings and checks', children }: { title?: string; children: ReactNode }) {
  return (
    <details className="page manage">
      <summary className="manage-summary">{title}</summary>
      <div className="manage-body">{children}</div>
    </details>
  );
}
