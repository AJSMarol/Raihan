import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6">
      <div className="max-w-md">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Page not found</h1>
        <p className="mt-2 text-ink-soft">The address doesn't match any page in this app.</p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-lapis-700 px-4 py-2 text-sm font-medium text-white hover:bg-lapis-600"
        >
          Back to start
        </Link>
      </div>
    </main>
  );
}
