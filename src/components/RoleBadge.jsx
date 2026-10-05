import { ROLE_LABELS } from '@/config/roles';

const STYLES = {
  admin: 'bg-lapis-100 text-lapis-700',
  scheduler: 'bg-raihan-100 text-raihan-700',
  monitor: 'bg-saffron-100 text-saffron-700',
  viewer: 'bg-pearl text-ink-soft',
};

export default function RoleBadge({ role }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        STYLES[role] ?? STYLES.viewer
      }`}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}
