import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';

export default function Layout({ children }) {
  const { user, logout, isDirection, isFloor, canOrders } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  // Build the nav from role capabilities.
  const links = [['/', t('nav.dashboard')]];
  if (isFloor) {
    links.push(['/sales', t('nav.sales')]);
    links.push(['/stock', t('nav.stock')]);
    links.push(['/pertes', t('nav.pertes')]);
    links.push(['/emballage', t('nav.emballage')]);
    links.push(['/pertes-view', t('nav.pertesView')]);
  }
  if (canOrders) links.push(['/orders', t('nav.orders')]);

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

  const close = () => setMenuOpen(false);

  return (
    <div className={`app ${menuOpen ? 'menu-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          {t('app.name')}
          <small>{t('app.tagline')}</small>
        </div>
        <nav onClick={close}>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>
          ))}
          {directionLinks.map(([to, label]) => (
            <NavLink key={to} to={to}>{label}</NavLink>
          ))}
        </nav>
      </aside>

      {/* Dim overlay behind the mobile drawer */}
      <div className="scrim" onClick={close} />

      <main className="main">
        <div className="topbar">
          <button className="hamburger" aria-label="menu" onClick={() => setMenuOpen((v) => !v)}>☰</button>
          <span className="userchip">{user.username} · {t(`roles.${user.role}`)}</span>
          <div style={{ flex: 1 }} />
          <button className="lang" onClick={() => setLang(lang === 'ar' ? 'fr' : 'ar')} aria-label="language">
            {lang === 'ar' ? 'FR' : 'ع'}
          </button>
          <NavLink to="/change-password" className="topbar-link">{t('nav.changePassword')}</NavLink>
          <button className="secondary" onClick={logout}>{t('nav.logout')}</button>
        </div>
        {children}
      </main>
    </div>
  );
}
