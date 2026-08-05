import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';

export default function Layout({ children }) {
  const { user, logout, isDirection, isFloor, canOrders } = useAuth();
  const { t } = useI18n();

  // Build the nav from role capabilities.
  const links = [['/', t('nav.dashboard')]];
  if (isFloor) {
    links.push(['/night-count', t('nav.nightcount')]);
    links.push(['/daily', t('nav.daily')]);
  }
  if (canOrders) links.push(['/orders', t('nav.orders')]);

  // Direction-only management screens.
  const directionLinks = isDirection
    ? [
        ['/waste', t('nav.waste')],
        ['/initial-stock', t('nav.initialstock')],
        ['/items', t('nav.items')],
        ['/recipes', t('nav.recipes')],
        ['/buffers', t('nav.buffers')],
        ['/users', t('nav.users')],
        ['/audit', t('nav.audit')],
      ]
    : [];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          {t('app.name')}
          <small>{t('app.tagline')}</small>
        </div>
        <nav>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
            </NavLink>
          ))}
          {directionLinks.map(([to, label]) => (
            <NavLink key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <div className="topbar">
          <span className="userchip">
            {user.username} · {t(`roles.${user.role}`)}
          </span>
          <div style={{ flex: 1 }} />
          <NavLink to="/change-password" style={{ fontSize: 13 }}>{t('nav.changePassword')}</NavLink>
          <button className="secondary" onClick={logout}>
            {t('nav.logout')}
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}
