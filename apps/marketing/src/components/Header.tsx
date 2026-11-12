import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { NAV, POS_LOGIN } from '../constants';
import { menuAria, nextMenuOpen } from '../nav/menu';
import { playSound } from '../sound/engine';
import { SoundToggle } from './SoundToggle';

export function Header() {
  const [open, setOpen] = useState(false);
  const aria = menuAria(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="zw-header">
      <div className="zw-wrap zw-header__inner">
        <Link to="/" className="zw-logo" aria-label="ZELVERO home" viewTransition>
          <span className="zw-logo__mark" aria-hidden />
          ZELVERO
        </Link>
        <nav className="zw-nav" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              viewTransition
              className={({ isActive }) => (isActive ? 'is-on' : '')}
              onClick={() => playSound('nav')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="zw-header__right">
          <SoundToggle />
          <a className="zw-link zw-header__signin" href={POS_LOGIN}>
            Sign In
          </a>
          <Link
            className="zw-btn zw-btn--primary zw-btn--sm zw-header__trial"
            data-magnetic
            to="/trial"
            viewTransition
            onClick={() => playSound('primary')}
          >
            Start Free Trial
          </Link>
          <button
            type="button"
            className="zw-burger"
            aria-expanded={aria.expanded}
            aria-controls="mobile-nav"
            aria-label={aria.label}
            onClick={() => {
              playSound('toggle');
              setOpen((v) => nextMenuOpen(v, 'toggle'));
            }}
          >
            <span />
          </button>
        </div>
      </div>
      {open && (
        <div id="mobile-nav" className="zw-drawer" role="dialog" aria-label="Menu">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} viewTransition onClick={() => setOpen(false)}>
              {item.label}
            </NavLink>
          ))}
          <a href={POS_LOGIN}>Sign In</a>
          <Link to="/trial" onClick={() => setOpen(false)}>
            Start Free Trial
          </Link>
        </div>
      )}
    </header>
  );
}
