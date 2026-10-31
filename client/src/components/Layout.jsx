import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BadgePercent, Boxes, CalendarClock, CreditCard, FileStack, FileText, LayoutDashboard, LogOut, Mail, Menu, Receipt, Repeat, Settings2, Users, UserCog, X } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { cx } from './ui.jsx';

const NAV = [
  { section: 'Operations', roles: ['admin', 'staff'], items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/subscriptions', label: 'Subscriptions', icon: Repeat },
    { to: '/invoices', label: 'Invoices', icon: FileText },
    { to: '/payments', label: 'Payments', icon: CreditCard },
    { to: '/customers', label: 'Customers', icon: Users },
  ] },
  { section: 'Catalogue', roles: ['admin', 'staff'], items: [
    { to: '/products', label: 'Products', icon: Boxes },
    { to: '/plans', label: 'Plans', icon: CalendarClock },
    { to: '/templates', label: 'Quote templates', icon: FileStack },
  ] },
  { section: 'Configuration', roles: ['admin'], items: [
    { to: '/taxes', label: 'Taxes', icon: Receipt },
    { to: '/discounts', label: 'Discounts', icon: BadgePercent },
    { to: '/users', label: 'Users', icon: UserCog },
    { to: '/operations', label: 'Billing & email', icon: Mail },
  ] },
  { section: 'My account', roles: ['customer'], items: [
    { to: '/', label: 'My subscriptions', icon: Repeat, end: true },
    { to: '/invoices', label: 'My invoices', icon: FileText },
    { to: '/payments', label: 'Payment history', icon: CreditCard },
  ] },
];

export const Logo = ({ className }) => (
  <div className={cx('flex items-center gap-2 font-semibold tracking-tight', className)}>
    <svg viewBox="0 0 32 32" className="h-7 w-7"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="5" className="text-brand-600" /><circle cx="16" cy="16" r="3.5" className="fill-brand-600" /><path d="M16 4a12 12 0 0 1 12 12" fill="none" stroke="#a5b4fc" strokeWidth="5" strokeLinecap="round" /></svg>
    <span>Brightloop</span>
  </div>
);

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const sections = NAV.filter((s) => s.roles.includes(user.role));

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5"><Logo className="text-slate-900" />
        <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {sections.map((s) => (
          <div key={s.section}>
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.section}</div>
            {s.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
                className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
                <Icon className="h-4 w-4" />{label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{user.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-slate-900">{user.name}</div><div className="truncate text-xs capitalize text-slate-500">{user.role}</div></div>
          <button onClick={() => nav('/account')} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Account"><Settings2 className="h-4 w-4" /></button>
          <button onClick={logout} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block no-print">{sidebar}</aside>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}><aside className="h-full w-72 bg-white" onClick={(e) => e.stopPropagation()}>{sidebar}</aside></div>}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden no-print">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button><Logo className="text-slate-900" />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><Outlet /></main>
      </div>
    </div>
  );
}
