import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { AlertCircle, Loader2 } from 'lucide-react';
import { missingEnv } from '@/config/env';
import { ROLE_HOME } from '@/config/roles';
import { useAuth } from '@/context/useAuth';
import { canAccessPath } from '@/routes/routeConfig';

/* Decorative motif: one teacher's week. Wednesday has the fewest main-campus periods,
   so that is the Raihan day, and the Raihan classes take alternate periods (2, 4, 6). */
const DAYS = [
  { label: 'Mon', main: [1, 2, 3, 5, 6], raihan: [] },
  { label: 'Tue', main: [2, 3, 4, 6], raihan: [] },
  { label: 'Wed', main: [1], raihan: [2, 4, 6] },
  { label: 'Thu', main: [1, 3, 4, 5, 7], raihan: [] },
  { label: 'Fri', main: [1, 2, 4, 5], raihan: [] },
  { label: 'Sat', main: [2, 3, 6], raihan: [] },
];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

const CELL_STYLES = {
  empty: 'bg-white/5',
  main: 'bg-lapis-500/70',
  raihan: 'bg-saffron-400',
};

function cellKind(day, period) {
  if (day.raihan.includes(period)) return 'raihan';
  if (day.main.includes(period)) return 'main';
  return 'empty';
}

function WeekMotif() {
  return (
    <div className="w-full max-w-md">
      <div aria-hidden="true" className="grid grid-cols-[1.25rem_repeat(6,minmax(0,1fr))] gap-1.5">
        <span />
        {DAYS.map((day) => (
          <span key={day.label} className="pb-1 text-center text-xs text-lapis-100">
            {day.label}
          </span>
        ))}
        {PERIODS.map((period) => (
          <div key={period} className="contents">
            <span className="grid place-items-center text-xs text-lapis-100">{period}</span>
            {DAYS.map((day) => (
              <span
                key={`${day.label}-${period}`}
                className={`h-9 rounded-sm ${CELL_STYLES[cellKind(day, period)]}`}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-5 flex gap-5 text-sm text-lapis-100">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-lapis-500/70" />
          Main campus
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-saffron-400" />
          Raihan
        </span>
      </div>
      <p className="mt-4 max-w-sm text-sm leading-relaxed text-lapis-100">
        Wednesday has the fewest main-campus periods, so this teacher's Raihan classes go in
        periods 2, 4 and 6.
      </p>
    </div>
  );
}

export default function LoginPage() {
  const { status, user, error, signIn } = useAuth();
  const location = useLocation();
  const [clientError, setClientError] = useState(null);

  if (status === 'authenticated') {
    const from = location.state?.from?.pathname;
    const target = from && canAccessPath(user.role, from) ? from : ROLE_HOME[user.role];
    return <Navigate to={target} replace />;
  }

  const checking = status === 'bootstrapping' || status === 'authenticating';
  const message = error ?? clientError;

  return (
    <main className="grid min-h-screen bg-paper lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="flex items-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="w-full max-w-md">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            Raihan Timetable AI
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-ink-soft">
            Sign in with the Google account your admin registered to open your timetable, class
            form, or scheduling tools.
          </p>

          <div className="mt-10 min-h-[44px]">
            {missingEnv.length > 0 ? (
              <p className="rounded-md border border-saffron-500/40 bg-saffron-100 p-3 text-sm text-saffron-700">
                Missing configuration: {missingEnv.join(', ')}. Copy <code>.env.example</code> to{' '}
                <code>.env.local</code>, fill it in, and restart the dev server.
              </p>
            ) : checking ? (
              <p role="status" className="flex items-center gap-3 text-ink-soft">
                <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Checking your access
              </p>
            ) : (
              <GoogleLogin
                onSuccess={({ credential }) => {
                  setClientError(null);
                  if (credential) signIn(credential);
                }}
                onError={() =>
                  setClientError(
                    "Google sign-in didn't complete. Allow pop-ups for this site and try again.",
                  )
                }
                theme="outline"
                size="large"
                shape="rectangular"
                text="signin_with"
                width="320"
              />
            )}
          </div>

          {message && (
            <p
              role="alert"
              className="mt-6 flex gap-2 rounded-md border border-saffron-500/40 bg-saffron-100 p-3 text-sm text-saffron-700"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {message}
            </p>
          )}

          <p className="mt-10 text-sm text-ink-soft">
            Each teacher is scheduled at Raihan on one day a week.
          </p>
        </div>
      </section>

      <aside className="hidden flex-col items-center justify-center gap-10 bg-lapis-900 p-12 lg:flex">
        <p lang="ar" dir="rtl" className="text-7xl leading-none text-white">
          ريحان
        </p>
        <WeekMotif />
      </aside>
    </main>
  );
}
