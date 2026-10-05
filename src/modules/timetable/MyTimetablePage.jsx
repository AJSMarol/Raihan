import ModulePlaceholder from '@/components/ModulePlaceholder';
import { useAuth } from '@/context/useAuth';

export default function MyTimetablePage() {
  const { user } = useAuth();

  return (
    <ModulePlaceholder
      title="My timetable"
      summary={
        user.teacherId
          ? `Your generated timetable (teacher ID ${user.teacherId}).`
          : 'A teacher’s generated timetable. Admins will choose the teacher here.'
      }
      upcoming={['Personal Day x Period timetable showing main-campus and Raihan periods']}
    />
  );
}
