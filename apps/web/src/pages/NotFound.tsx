import { Link } from 'react-router-dom';
import { SvgIcon } from '../components/ui/SvgIcon';

export default function NotFound() {
  return (
    <main className="not-found">
      <span className="nf-icon" aria-hidden="true"><SvgIcon name="search" size={34} /></span>
      <h1>We could not find that page</h1>
      <p>The link may be old, or the page was moved. Try the home page, or search for what you wanted.</p>
      <div className="nf-actions">
        <Link to="/" className="btn btn-primary">Back to Home</Link>
        <Link to="/search" className="btn btn-secondary"><SvgIcon name="search" size={16} /> Search</Link>
      </div>
    </main>
  );
}
