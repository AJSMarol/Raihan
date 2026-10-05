import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { LogOut, Menu, X } from 'lucide-react';
import RoleBadge from '@/components/RoleBadge';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/context/useAuth';
import { routesForRole } from '@/routes/routeConfig';

function Avatar({ user }) {
  const [failed, setFailed] = useState(false);

  if (user.picture && !failed) {
    return (
      <img
        src={user.picture}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lapis-100 text-sm font-semibold text-lapis-700"
    >
      {user.name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const items = routesForRole(user.role);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKeyDown = (event) => event.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink/10 bg-paper/95 px-4 py-3 backdrop-blur lg:hidden print:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          aria-controls="app-nav"
          aria-expanded={navOpen}
          className="rounded-md p-2 text-ink hover:bg-pearl"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="font-display text-lg font-semibold">Raihan Timetable AI</span>
      </header>

      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-nav"
        className={clsx(
          'fixed inset-y-0 start-0 z-50 flex w-72 flex-col bg-lapis-900 text-white transition-transform motion-reduce:transition-none',
          'lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 print:hidden',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-6 pb-4 pt-6">
          <span className="font-display text-xl font-semibold tracking-tight">Raihan Timetable AI</span>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-lapis-100 hover:bg-white/10 lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="space-y-1">
            {items.map(({ path, label, icon: Icon }) => (
              <li key={path}>
                <NavLink
                  to={path}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium',
                      isActive
                        ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#E0AE4F]'
                        : 'text-lapis-100 hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <Avatar user={user} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-lapis-100">{user.email}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <RoleBadge role={user.role} />
            <button
              type="button"
              onClick={() => signOut()}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 p-5 sm:p-8 lg:p-10">
        <Suspense fallback={<Spinner label="Loading" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
