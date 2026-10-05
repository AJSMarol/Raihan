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
      upcoming={['Planned for Phase 3: pre-relocation syllabus reports and teacher briefings.']}
    />
  );
}
