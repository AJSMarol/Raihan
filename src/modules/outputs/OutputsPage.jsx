import ModulePlaceholder from '@/components/ModulePlaceholder';

export default function OutputsPage() {
  return (
    <ModulePlaceholder
      title="Exports & crosstab"
      summary="Download the finalised allocations and print the schedule for a class."
      upcoming={[
        'JHS CSV export: Date, Period, Class, Subject, Teacher Name, Teacher ID',
        'Printable, colour-coded Day x Period crosstab for a selected class',
      ]}
    />
  );
}
