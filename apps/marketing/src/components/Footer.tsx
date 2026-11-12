import { Link } from 'react-router';
import { INDUSTRIES } from '../content/industries';

export function Footer() {
  return (
    <footer className="zw-footer">
      <div className="zw-wrap zw-footer__grid">
        <div>
          <p className="zw-logo">ZELVERO</p>
          <p className="zw-note">The operating system for modern businesses.</p>
        </div>
        <div>
          <h3>Product</h3>
          <Link viewTransition to="/product">Overview</Link>
          <Link viewTransition to="/demo">Demo</Link>
          <Link viewTransition to="/trial">Free trial</Link>
          <Link viewTransition to="/quote">Quote</Link>
        </div>
        <div>
          <h3>Industries</h3>
          {INDUSTRIES.map((i) => (
            <Link key={i.slug} viewTransition to={`/industries/${i.slug}`}>
              {i.name}
            </Link>
          ))}
        </div>
        <div>
          <h3>Resources</h3>
          <Link viewTransition to="/resources">Help Center</Link>
          <Link viewTransition to="/partners">Partners</Link>
          <Link viewTransition to="/contact">Contact</Link>
        </div>
        <div>
          <h3>Company</h3>
          <Link viewTransition to="/legal/privacy">Privacy</Link>
          <Link viewTransition to="/legal/terms">Terms</Link>
          <Link viewTransition to="/legal/security">Security</Link>
          <Link viewTransition to="/status">Status</Link>
        </div>
        <div>
          <h3>Legal</h3>
          <p className="zw-note">Public pricing is available by quote until a published list ships.</p>
        </div>
      </div>
    </footer>
  );
}
