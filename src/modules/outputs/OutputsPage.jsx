import ModulePlaceholder from '@/components/ModulePlaceholder';

export default function OutputsPage() {
  return (
    <ModulePlaceholder
      title="Exports & crosstab"
      summary="Generated schedules are stored in Raihan_Allocations. Printable views and downloads are not built yet."
      upcoming={[
        'JHS-compliant export and printable, colour-coded Day x Period crosstab',
        'Class/teacher filters, full-screen view, and PDF export',
      ]}
    />
  );
}
