import ModulePlaceholder from '@/components/ModulePlaceholder';
import { useAuth } from '@/context/useAuth';

export default function SyllabusPage() {
  const { user } = useAuth();

  return (
    <ModulePlaceholder
      title="Syllabus update"
      summary={
        user.assignedClass
          ? `Progress form for class ${user.assignedClass}.`
          : 'Progress form for a class. Admins will choose the class here.'
      }
      upcoming={[
        'Phase 1: Covered till now (before the week starts)',
        'Phase 2: Covered during Raihan (end of the week)',
      ]}
    />
  );
}
