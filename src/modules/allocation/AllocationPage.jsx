import ModulePlaceholder from '@/components/ModulePlaceholder';

export default function AllocationPage() {
  return (
    <ModulePlaceholder
      title="Allocation"
      summary="Choose each Raihan-bound teacher's single travel day and place their periods."
      upcoming={[
        'Pick the day with the fewest main-campus periods',
        'Priority 1: alternate periods (2, 4, 6)',
        'Priority 2: any free slot on that day',
      ]}
    />
  );
}
