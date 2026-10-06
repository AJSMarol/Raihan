import { useEffect, useState } from 'react';
import { AlertCircle, Check, Clipboard, Loader2, MessageCircle } from 'lucide-react';
import { ApiError, UNKNOWN_ERROR_MESSAGE, apiCall } from '@/services/api';
import { getActiveAllocationWeek, getAllocationAdvisory, setActiveAllocationWeek } from '@/modules/allocation/allocationSession';

const WEEK_NUMBERS = Array.from({ length: 41 }, (_, index) => index + 1);

function displayDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function createNotice(audience, week, teachers) {
  const dateRange = `${displayDate(week.startDate)} to ${displayDate(week.endDate)}`;
  if (audience === 'students') {
    return [
      'RAIHAN CAMPUS NOTICE',
      `Week ${week.weekNo} (${dateRange})`,
      `Classes attending Raihan: ${week.classes.join(', ')}.`,
      'Please follow the instructions and timetable shared by your Asateza.',
    ].join('\n');
  }

  const travelDays = teachers.length
    ? teachers
        .map((teacher) => `${teacher.teacherName} (${teacher.teacherId}): ${teacher.raihanDay}`)
        .join('\n')
    : 'Teacher travel-day advisory will be available after schedule analysis.';
  return [
    'ASATEZA OPERATIONAL NOTICE',
    `Week ${week.weekNo} (${dateRange})`,
    `Classes attending Raihan: ${week.classes.join(', ')}.`,
    'Assigned Raihan days:',
    travelDays,
    'Please review the advisory and coordinate any home-campus timetable adjustments.',
  ].join('\n');
}

export default function WhatsAppPage() {
  const [weekNo, setWeekNo] = useState(getActiveAllocationWeek);
  const [week, setWeek] = useState(null);
  const [advisory, setAdvisory] = useState(() => getAllocationAdvisory(getActiveAllocationWeek()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    setActiveAllocationWeek(weekNo);
    setAdvisory(getAllocationAdvisory(weekNo));
    apiCall('relocation.getWeek', { weekNo })
      .then((result) => {
        if (!active) return;
        setWeek(result?.week ?? null);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
        setWeek(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [weekNo]);

  const copyNotice = async (audience) => {
    try {
      await navigator.clipboard.writeText(createNotice(audience, week, advisory?.teachers ?? []));
      setError(null);
      setMessage(`${audience === 'students' ? 'Student' : 'Asateza'} notice copied.`);
    } catch {
      setError('Could not copy the notice. Check clipboard permission and try again.');
    }
  };

  const openWhatsApp = (audience) => {
    const text = createNotice(audience, week, advisory?.teachers ?? []);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="mx-auto max-w-5xl space-y-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-raihan-700">Communications</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">WhatsApp notices</h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          Prepare student and Asateza notices separately from schedule generation. Copy a notice or open WhatsApp with its text ready to send.
        </p>
      </header>

      {error && (
        <p role="alert" className="flex gap-2 rounded-md border border-saffron-500/40 bg-saffron-100 p-3 text-sm text-saffron-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
      {message && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-raihan-500/30 bg-raihan-100 p-3 text-sm text-raihan-700">
          <Check className="h-4 w-4" aria-hidden="true" /> {message}
        </p>
      )}

      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
        <label className="block max-w-xs text-sm font-medium text-ink">
          Week
          <select
            value={weekNo}
            onChange={(event) => setWeekNo(Number(event.target.value))}
            disabled={loading}
            className="mt-1.5 block w-full rounded-md border border-ink/20 bg-white px-3 py-2"
          >
            {WEEK_NUMBERS.map((number) => <option key={number} value={number}>Week {number}</option>)}
          </select>
        </label>

        {loading ? (
          <p role="status" className="mt-5 flex items-center gap-2 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Loading saved Week {weekNo} setup…
          </p>
        ) : !week ? (
          <p className="mt-5 rounded-md bg-paper p-4 text-sm text-ink-soft">
            Save the relocation setup for Week {weekNo} in Allocation before preparing notices.
          </p>
        ) : (
          <>
            <div className="mt-5 rounded-md bg-paper p-4 text-sm text-ink-soft">
              <p className="font-medium text-ink">Week {week.weekNo}</p>
              <p>{displayDate(week.startDate)} to {displayDate(week.endDate)}</p>
              <p>Classes: {week.classes.join(', ')}</p>
            </div>
            {!advisory && (
              <p className="mt-3 text-sm text-ink-soft">
                No schedule analysis is cached for this week yet. The Asateza notice will include a reminder that teacher travel days are pending.
              </p>
            )}
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              {[
                { key: 'students', title: 'For students' },
                { key: 'asateza', title: 'For Asateza' },
              ].map(({ key, title }) => (
                <article key={key} className="rounded-lg border border-ink/10 bg-paper p-4">
                  <h2 className="font-medium text-ink">{title}</h2>
                  <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-soft">
                    {createNotice(key, week, advisory?.teachers ?? [])}
                  </pre>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyNotice(key)}
                      className="inline-flex items-center gap-2 rounded-md border border-ink/20 bg-white px-3 py-2 text-sm hover:bg-pearl"
                    >
                      <Clipboard className="h-4 w-4" aria-hidden="true" /> Copy notice
                    </button>
                    <button
                      type="button"
                      onClick={() => openWhatsApp(key)}
                      className="inline-flex items-center gap-2 rounded-md bg-raihan-700 px-3 py-2 text-sm text-white hover:bg-raihan-500"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" /> Open WhatsApp
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </section>
  );
}
