import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api, type BrokerId, type BrokerMeta } from '../api';
import { usePrivacy } from '../privacy';

/** Fired after enable/disable so nav can refresh without a full reload. */
export const BROKERS_CHANGED_EVENT = 'portfolio:brokers-changed';

export function notifyBrokersChanged(): void {
  window.dispatchEvent(new Event(BROKERS_CHANGED_EVENT));
}

export function AppNav() {
  const { masked, toggle } = usePrivacy();
  const location = useLocation();
  const [links, setLinks] = useState<{ id: BrokerId; label: string; to: string }[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener(BROKERS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(BROKERS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .brokers()
      .then((status) => {
        if (cancelled) return;
        const byId = new Map<BrokerId, BrokerMeta>(status.catalog.map((c) => [c.id, c]));
        setLinks(
          status.enabled.map((id) => {
            const meta = byId.get(id);
            return {
              id,
              label: meta?.displayName ?? id,
              to: meta?.href ?? `/${id}`,
            };
          }),
        );
      })
      .catch(() => {
        /* Overview still works without nav extras */
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, tick]);

  return (
    <div className="app-nav-row">
      <nav className="app-nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
          Overview
        </NavLink>
        {links.map((l) => (
          <NavLink
            key={l.id}
            to={l.to}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            {l.label === 'ABN AMRO Guided Investing' ? 'ABN AMRO' : l.label}
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
