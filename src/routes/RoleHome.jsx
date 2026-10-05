import { Navigate } from 'react-router-dom';
import { ROLE_HOME } from '@/config/roles';
import { useAuth } from '@/context/useAuth';

/** "/" sends each role to its own starting page. */
export default function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={ROLE_HOME[user.role]} replace />;
}
