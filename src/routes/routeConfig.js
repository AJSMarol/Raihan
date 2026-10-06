import { lazy } from 'react';
import {
  AlertTriangle,
  BookOpenCheck,
  CalendarClock,
  CalendarDays,
  FileDown,
  LayoutGrid,
  RefreshCcw,
  Send,
} from 'lucide-react';
import { ROLES } from '@/config/roles';

const { ADMIN, SCHEDULER, MONITOR, VIEWER } = ROLES;

/**
 * Single source of truth for routing AND the sidebar.
 * Add a module here and it gets a protected route and a nav entry for the listed roles.
 * (The Apps Script backend enforces the same roles independently - this is UX, not security.)
 */
export const appRoutes = [
  {
    path: '/allocation',
    label: 'Allocation',
    icon: CalendarClock,
    roles: [ADMIN, SCHEDULER],
    component: lazy(() => import('@/modules/allocation/AllocationPage')),
  },
  {
    path: '/lag',
    label: 'Lag dashboard',
    icon: AlertTriangle,
    roles: [ADMIN, SCHEDULER],
    component: lazy(() => import('@/modules/conflicts/LagDashboardPage')),
  },
  {
    path: '/compensation',
    label: 'Compensation advisory',
    icon: RefreshCcw,
    roles: [ADMIN, SCHEDULER],
    component: lazy(() => import('@/modules/conflicts/CompensationPage')),
  },
  {
    path: '/temp-teachers',
    label: 'Temporary teachers',
    icon: LayoutGrid,
    roles: [ADMIN, SCHEDULER],
    component: lazy(() => import('@/modules/conflicts/TempTeacherGridPage')),
  },
  {
    path: '/outputs',
    label: 'Raihan final timetable',
    icon: FileDown,
    roles: [ADMIN, SCHEDULER],
    component: lazy(() => import('@/modules/outputs/OutputsPage')),
  },
  {
    path: '/whatsapp',
    label: 'WhatsApp broadcast',
    icon: Send,
    roles: [ADMIN, SCHEDULER],
    component: lazy(() => import('@/modules/whatsapp/WhatsAppPage')),
  },
  {
    path: '/syllabus',
    label: 'Syllabus update',
    icon: BookOpenCheck,
    roles: [ADMIN, MONITOR],
    component: lazy(() => import('@/modules/syllabus/SyllabusPage')),
  },
  {
    path: '/my-timetable',
    label: 'My timetable',
    icon: CalendarDays,
    roles: [ADMIN, VIEWER],
    component: lazy(() => import('@/modules/timetable/MyTimetablePage')),
  },
];

export const routesForRole = (role) => appRoutes.filter((route) => route.roles.includes(role));

export const canAccessPath = (role, pathname) =>
  appRoutes.some((route) => route.path === pathname && route.roles.includes(role));
