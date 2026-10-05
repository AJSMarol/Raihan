import ModulePlaceholder from '@/components/ModulePlaceholder';

export default function LagDashboardPage() {
  return (
    <ModulePlaceholder
      title="Lag dashboard"
      summary="Subjects whose Raihan periods don't fit into the teacher's free slots on their Raihan day."
      upcoming={['Flag subjects as Lagging / Unallocated']}
    />
  );
}
