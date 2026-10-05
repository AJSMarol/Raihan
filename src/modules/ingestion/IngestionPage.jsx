import ModulePlaceholder from '@/components/ModulePlaceholder';

export default function IngestionPage() {
  return (
    <ModulePlaceholder
      title="Upload & clean"
      summary="Upload the main campus (JHS) CSV export, remove duplicate rows, and tag secondary teachers."
      upcoming={[
        'Drag-and-drop CSV upload',
        'Remove duplicate class / subject / teacher / date rows',
        'Tag teacher IDs starting with 78652 as secondary (MUSANID)',
      ]}
    />
  );
}
