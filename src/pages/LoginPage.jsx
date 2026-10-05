import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { AlertCircle } from 'lucide-react';
import { ROLE_HOME } from '@/config/roles';
import { useAuth } from '@/context/useAuth';
import { canAccessPath } from '@/routes/routeConfig';

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
  const backgroundImage = `${import.meta.env.BASE_URL}login-background.jpg`;

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-lapis-900">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 bg-cover bg-center"
        style={{ backgroundImage: `url("${backgroundImage}")` }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-lapis-900/75 via-lapis-900/40 to-lapis-900/15"
      />

      <section
        aria-label="Sign in"
        className={`absolute bottom-[10%] left-[10%] z-10 ${checking ? 'pointer-events-none opacity-60' : ''}`}
        aria-busy={checking}
      >
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
            type="standard"
            size="large"
            shape="rectangular"
            text="signin_with"
            logo_alignment="left"
            width="360"
          />
      </section>

      {message && (
        <p
          role="alert"
          className="absolute bottom-4 left-4 z-20 flex max-w-[calc(100%-2rem)] gap-2 rounded-md border border-saffron-300/50 bg-saffron-100/95 p-3 text-sm text-saffron-700 shadow-lg sm:bottom-6 sm:left-6"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {message}
        </p>
      )}
    </main>
  );
}
