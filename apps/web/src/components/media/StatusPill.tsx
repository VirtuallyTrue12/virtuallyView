export function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const value = (status ?? '').toLowerCase();
  let cls = `status-${value}`;
  if (value === 'failed' || value === 'cancelled') cls += ' status-pill--danger';
  else if (value === 'available' || value === 'downloading' || value === 'importing') cls += ' status-pill--positive';
  else if (value === 'pending' || value === 'searching') cls += ' status-pill--muted';
  else if (value === 'stalled') cls += ' status-pill--warning';
  return <span className={`status-pill ${cls}`}>{value}</span>;
}