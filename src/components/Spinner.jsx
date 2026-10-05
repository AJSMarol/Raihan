import { Loader2 } from 'lucide-react';

export default function Spinner({ label = 'Loading', fullScreen = false }) {
  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-3 text-ink-soft ${
        fullScreen ? 'min-h-screen' : 'py-16'
      }`}
    >
      <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
