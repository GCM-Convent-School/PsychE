import React, { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, CalendarPlus, LogOut, Menu, Moon, Plus, Search, Settings as SettingsIcon, Sun, Tag, UserPlus, X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useBranding, PRODUCT_NAME } from '../lib/branding';
import { useTheme } from '../lib/theme';
import { openPalette } from '../lib/palette';
import { initials } from '../utils/initials';
import { Avatar } from './Avatar';
import { CommandPalette } from './CommandPalette';

// The shell, after the journey reference: a top bar of plain text links where
// the current page is the one black pill, round controls on the right, and a
// left rail of round quick actions with the light/dark pair at its foot.

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/directory', label: 'Students' },
  { to: '/kanban', label: 'Calendar' },
  { to: '/logs', label: 'Sessions' },
  { to: '/analytics', label: 'Insights' },
  { to: '/library', label: 'Library' },
];
const RAIL = [
  { tip: 'Log a session', Icon: Plus, to: '/add-log' },
  { tip: 'Add a student', Icon: UserPlus, to: '/add-student' },
  { tip: 'Book sessions', Icon: CalendarPlus, to: '/bulk-schedule' },
  { tip: 'Day view', Icon: CalendarDays, to: '/day' },
  { tip: 'Problem tags', Icon: Tag, to: '/tags' },
  { tip: 'Settings', Icon: SettingsIcon, to: '/settings' },
];

const Brand: React.FC = () => {
  const { schoolName, logoUrl } = useBranding();
  return (
    <Link to="/" className="brand" aria-label={`${PRODUCT_NAME} home`}>
      {logoUrl
        ? <img src={logoUrl} alt="" className="brand-logo" />
        : <span className="brand-logo brand-logo--mark" aria-hidden="true">{initials(schoolName ?? PRODUCT_NAME)}</span>}
      <span className="brand-text">
        <span className="brand-school">{schoolName ?? PRODUCT_NAME}</span>
        <span className="brand-product">{PRODUCT_NAME}</span>
      </span>
    </Link>
  );
};

const ThemePair: React.FC = () => {
  const { resolved, setTheme } = useTheme();
  return (
    <div className="theme-pair" role="group" aria-label="Theme">
      <button type="button" className={`round${resolved === 'dark' ? ' round--dark' : ''}`} aria-pressed={resolved === 'dark'} data-tip="Dark" aria-label="Dark theme" onClick={() => setTheme('dark')}><Moon size={16} /></button>
      <button type="button" className={`round${resolved === 'light' ? ' round--dark' : ''}`} aria-pressed={resolved === 'light'} data-tip="Light" aria-label="Light theme" onClick={() => setTheme('light')}><Sun size={16} /></button>
    </div>
  );
};

export const Layout: React.FC = () => {
  const navigate = useNavigate();
  const { staff, signOut } = useAuth();
  // The phone menu belongs to the page it was opened on, so it closes itself
  // when the page changes.
  const { pathname } = useLocation();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuOpen = menuFor === pathname;

  return (
    <div className="app-container">
      <header className="topbar no-print">
        <div className="topbar-inner">
          <button type="button" className="round round--ghost topbar-menu" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}
            onClick={() => setMenuFor(menuOpen ? null : pathname)}>{menuOpen ? <X size={18} /> : <Menu size={18} />}</button>
          <Brand />
          <nav className="nav-pills" aria-label="Main" data-open={menuOpen}>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}>{n.label}</NavLink>
            ))}
          </nav>
          <div className="topbar-actions">
            <button type="button" className="round" onClick={openPalette} title="Search (⌘K)" aria-label="Search"><Search size={16} /></button>
            <button type="button" className="round round--dark topbar-log" onClick={() => navigate('/add-log')} title="Log a session" aria-label="Log a session"><Plus size={16} /></button>
            <button type="button" className="topbar-avatar" onClick={() => { signOut(); }}
              title={staff ? `${staff.full_name} · sign out` : 'Sign out'} aria-label="Sign out">
              <Avatar name={staff?.full_name} />
            </button>
          </div>
        </div>
      </header>

      <nav className="rail no-print" aria-label="Quick actions">
        <button type="button" className="round" data-tip="Back" aria-label="Back" onClick={() => navigate(-1)}><ArrowLeft size={16} /></button>
        <span className="rail-gap" />
        {RAIL.map(({ tip, Icon, to }) => (
          <button key={to} type="button" className={`round${pathname === to ? ' round--on' : ''}`} data-tip={tip} aria-label={tip} onClick={() => navigate(to)}>
            <Icon size={16} />
          </button>
        ))}
        <span className="rail-spacer" />
        <ThemePair />
        <button type="button" className="round" data-tip="Sign out" aria-label="Sign out" onClick={() => { signOut(); }}><LogOut size={15} /></button>
      </nav>

      <main className="main-content">
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  );
};
