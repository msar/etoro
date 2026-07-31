import { NavLink } from 'react-router-dom';
import { usePrivacy } from '../privacy';

const LINKS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/etoro', label: 'eToro' },
  { to: '/abnamro', label: 'ABN AMRO' },
  { to: '/etrade', label: 'E*TRADE' },
];

export function AppNav() {
  const { masked, toggle } = usePrivacy();

  return (
    <div className="app-nav-row">
      <nav className="app-nav">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        className={`privacy-toggle ${masked ? 'active' : ''}`}
        onClick={toggle}
        aria-pressed={masked}
        title={masked ? 'Show amounts' : 'Hide amounts for screenshots'}
      >
        {masked ? 'Unhide amounts' : 'Hide amounts'}
      </button>
    </div>
  );
}
