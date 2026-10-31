import { Link } from 'react-router-dom';
import './OfflineBanner.css';

/** The line across the top when the server cannot be reached. */
export function OfflineBanner() {
  return (
    <div className="offline-banner" role="status">
      <span>You're offline – showing what's on this device</span>
      <Link to="/offline">Open On this device</Link>
    </div>
  );
}
