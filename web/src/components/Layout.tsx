import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  BrainCircuit,
  CheckSquare,
  FileStack,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Plug,
  Radar,
  Settings,
  Sun,
  Target,
  Users,
  X,
} from 'lucide-react';
import { cx, initials } from '../lib/format';
import { useAuth, useSystemStatus, useTheme } from '../lib/hooks';
import { Badge, ToastViewport } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: 'approvals';
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Command',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'Pipeline',
    items: [
      { to: '/research', label: 'Market Research', icon: Radar },
      { to: '/opportunities', label: 'Opportunities', icon: Target },
      { to: '/leads', label: 'Leads', icon: Users },
      { to: '/messages', label: 'Messages', icon: MessageSquare },
      { to: '/approvals', label: 'Approvals', icon: CheckSquare, badge: 'approvals' },
      { to: '/projects', label: 'Projects', icon: FileStack },
    ],
  },
  {
    title: 'Automation',
    items: [
      { to: '/agents', label: 'Agents', icon: Bot },
      { to: '/workflows', label: 'Workflows', icon: Boxes },
      { to: '/logs', label: 'Activity Logs', icon: Activity },
    ],
  },
  {
    title: 'Configure',
    items: [
      { to: '/integrations', label: 'Integrations', icon: Plug },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { status } = useSystemStatus();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
          <BrainCircuit className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">AI CEO</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Business discovery</p>
        </div>
        <button
          type="button"
          className="btn-ghost ml-auto px-2 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cx(
                        'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white',
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.badge === 'approvals' && (status?.pendingApprovals ?? 0) > 0 && (
                      <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {status?.pendingApprovals}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-3 dark:border-white/10">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-200">
            {user ? initials(user.name) : '–'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{user?.name}</p>
            <p className="truncate text-xs capitalize text-slate-500 dark:text-slate-400">{user?.role}</p>
          </div>
          <button type="button" onClick={logout} className="btn-ghost px-2" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block dark:border-white/10 dark:bg-[#0d1220]">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 animate-slide-in border-r border-slate-200 bg-white dark:border-white/10 dark:bg-[#0d1220]">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur lg:px-8 dark:border-white/10 dark:bg-[#0b0f19]/85">
          <button
            type="button"
            className="btn-ghost px-2 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {status && <ModeIndicators />}
          </div>

          <button type="button" onClick={toggle} className="btn-ghost px-2" aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1400px] animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      <ToastViewport />
    </div>
  );
}

/**
 * Always-visible truth about what the platform is currently doing: whether
 * discovery and reasoning are live or simulated, and whether sending is armed.
 */
function ModeIndicators() {
  const { status } = useSystemStatus();
  if (!status) return null;

  return (
    <>
      <Badge tone={status.liveDiscovery ? 'success' : 'warning'}>
        {status.liveDiscovery ? 'Live discovery' : 'Demo data'}
      </Badge>
      <Badge tone={status.liveReasoning ? 'success' : 'neutral'}>
        {status.liveReasoning ? 'Claude reasoning' : 'Rule engine'}
      </Badge>
      <Badge tone={status.outboundSendingEnabled ? 'danger' : 'neutral'}>
        {status.outboundSendingEnabled ? 'Sending enabled' : 'Sending disabled'}
      </Badge>
    </>
  );
}
