import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { ROLE_HOME, ROLE_LABELS } from '@/config/roles';
import { useAuth } from '@/context/useAuth';

export default function NotAuthorizedPage() {
  const { user } = useAuth();

  return (
    <section className="max-w-xl">
      <ShieldAlert className="h-8 w-8 text-saffron-500" aria-hidden="true" />
      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-ink">
        This page isn't available to your role
      </h1>
      <p className="mt-2 text-ink-soft">
        You're signed in as {ROLE_LABELS[user.role]}. Ask an admin if you need access to more tools.
      </p>
      <Link
        to={ROLE_HOME[user.role]}
        className="mt-6 inline-flex rounded-md bg-lapis-700 px-4 py-2 text-sm font-medium text-white hover:bg-lapis-600"
      >
        Go to your workspace
      </Link>
    </section>
  );
}
