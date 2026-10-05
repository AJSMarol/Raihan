import { Route, Routes } from 'react-router-dom';
import AppLayout from '@/layouts/AppLayout';
import LoginPage from '@/pages/LoginPage';
import NotAuthorizedPage from '@/pages/NotAuthorizedPage';
import NotFoundPage from '@/pages/NotFoundPage';
import ProtectedRoute from './ProtectedRoute';
import RoleHome from './RoleHome';
import { appRoutes } from './routeConfig';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Everything below requires a signed-in user */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<RoleHome />} />
          <Route path="/unauthorized" element={<NotAuthorizedPage />} />

          {/* One role-guarded route per module, generated from routeConfig */}
          {appRoutes.map(({ path, roles, component: Page }) => (
            <Route key={path} element={<ProtectedRoute allowedRoles={roles} />}>
              <Route path={path} element={<Page />} />
            </Route>
          ))}
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
