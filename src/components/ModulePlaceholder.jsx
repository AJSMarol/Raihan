/** Stand-in shown by modules that are scheduled for a later build step. */
export default function ModulePlaceholder({ title, summary, upcoming = [], children }) {
  return (
    <section className="max-w-3xl">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 max-w-prose text-ink-soft">{summary}</p>

      {children}

      {upcoming.length > 0 && (
        <div className="mt-8 rounded-lg border border-dashed border-ink/25 p-5">
          <h2 className="text-sm font-semibold text-ink">Still to build</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-ink-soft">
            {upcoming.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
