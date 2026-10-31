import type { ReactNode } from 'react';
import './PersonalRails.css';

/** A poster on the "Top 10 in Your Home" rail, with its big rank number beside it. */
export function RankedCard({ rank, children }: { rank: number; children: ReactNode }) {
  return (
    <div className="ranked-card">
      <span className="ranked-number" aria-hidden="true">{rank}</span>
      {children}
    </div>
  );
}
