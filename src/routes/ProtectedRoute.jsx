import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/context/useAuth';

/**
 * Layout route that guards its children.
 *   <ProtectedRoute />                          any signed-in user
 *   <ProtectedRoute allowedRoles={['admin']} /> only those roles
 */
export default function ProtectedRoute({ allowedRoles }) {
  const { status, user } = useAuth();
  const location = useLocation();

  // First load with a stored token: wait for the backend instead of bouncing to /login.
  if (status === 'bootstrapping' || status === 'authenticating') {
    return <Spinner fullScreen label="Checking your access" />;
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
