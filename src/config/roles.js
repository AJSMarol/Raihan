export const ROLES = Object.freeze({
  ADMIN: 'admin',
  SCHEDULER: 'scheduler',
  MONITOR: 'monitor',
  VIEWER: 'viewer',
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Admin',
  [ROLES.SCHEDULER]: 'Scheduler',
  [ROLES.MONITOR]: 'Class monitor',
  [ROLES.VIEWER]: 'Teacher',
});

/** Where each role lands after signing in. */
export const ROLE_HOME = Object.freeze({
  [ROLES.ADMIN]: '/allocation',
  [ROLES.SCHEDULER]: '/allocation',
  [ROLES.MONITOR]: '/syllabus',
  [ROLES.VIEWER]: '/my-timetable',
});

export const isValidRole = (value) => Object.values(ROLES).includes(value);
