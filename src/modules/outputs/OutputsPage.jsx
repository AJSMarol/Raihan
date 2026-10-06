import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, Loader2, RefreshCw } from 'lucide-react';
import { ApiError, UNKNOWN_ERROR_MESSAGE, apiCall } from '@/services/api';
import { getActiveAllocationWeek } from '@/modules/allocation/allocationSession';

const WEEK_NUMBERS = Array.from({ length: 41 }, (_, index) => index + 1);
const PERIODS = Array.from({ length: 9 }, (_, index) => `Period ${index + 1}`);

function displayDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

export default function OutputsPage() {
  const [searchParams] = useSearchParams();
  const [weekNo, setWeekNo] = useState(
    () => Number(searchParams.get('week')) || getActiveAllocationWeek(),
  );
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assigningRow, setAssigningRow] = useState(null);
  const [viewBy, setViewBy] = useState('subject');
  const [filter, setFilter] = useState('');
  const [selections, setSelections] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadWeek = async (targetWeek = weekNo) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall('allocation.getFinalWeek', { weekNo: targetWeek });
      if (!Array.isArray(result?.sessions) || !Array.isArray(result?.pending) ||
          !Array.isArray(result?.teachers) || !Array.isArray(result?.occupied)) {
        throw new ApiError('BAD_RESPONSE');
      }
      setData(result);
      setSelections({});
    } catch (requestError) {
      setData(null);
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWeek(weekNo);
  }, [weekNo]);

  const values = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.sessions.map((session) =>
      viewBy === 'teacher' ? session.teacherName : session.subject,
    ).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [data, viewBy]);

  const visibleSessions = useMemo(() => (
    data?.sessions.filter((session) => !filter ||
      (viewBy === 'teacher' ? session.teacherName : session.subject) === filter) ?? []
  ), [data, filter, viewBy]);

  const days = useMemo(() => {
    const byDate = {};
    visibleSessions.forEach((session) => {
      if (!byDate[session.date]) byDate[session.date] = { date: session.date, day: session.day, sessions: [] };
      byDate[session.date].sessions.push(session);
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [visibleSessions]);

  const availablePeriods = (pending, teacher) => PERIODS.filter((period) => {
    const occupied = data?.occupied ?? [];
    return !occupied.some((slot) => slot.date === teacher.date &&
      slot.period === period.replace('Period ', 'P') &&
      (slot.className === pending.className || slot.teacherIds.includes(teacher.teacherId)));
  });

  const setPendingSelection = (rowNumber, field, value) => {
    setSelections((current) => ({
      ...current,
      [rowNumber]: { ...current[rowNumber], [field]: value },
    }));
  };

  const assignPending = async (pending) => {
    const selection = selections[pending.rowNumber];
    if (!selection?.teacherId || !selection.period) return;
    setAssigningRow(pending.rowNumber);
    setError(null);
    setNotice(null);
    try {
      const result = await apiCall('allocation.assignLag', {
        weekNo,
        rowNumber: pending.rowNumber,
        teacherId: selection.teacherId,
        period: selection.period,
      });
      if (!Array.isArray(result?.sessions) || !Array.isArray(result?.pending)) {
        throw new ApiError('BAD_RESPONSE');
      }
      setData(result);
      setSelections({});
      setNotice(`Assigned ${pending.className} · ${pending.subject} to Raihan Period ${selection.period.replace('Period ', '')}.`);
    } catch (requestError) {
      const errorMessage = requestError instanceof ApiError
        ? requestError.message
        : UNKNOWN_ERROR_MESSAGE;
      if (requestError instanceof ApiError &&
          ['LAG_NOT_AVAILABLE', 'RAIHAN_CLASS_SLOT_OCCUPIED', 'RAIHAN_TEACHER_SLOT_OCCUPIED'].includes(requestError.code)) {
        await loadWeek(weekNo);
      }
      setError(errorMessage);
    } finally {
      setAssigningRow(null);
    }
  };

  return (
    <section className="mx-auto max-w-7xl space-y-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-raihan-700">Final schedule</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">Raihan allocation crosstab</h1>
        <p className="mt-3 max-w-4xl text-ink-soft">
          Review the Raihan day-by-day timetable, filter it by teacher or subject, and manually place pending selected-class sessions into a free period with a teacher already coming to Raihan that day.
        </p>
      </header>

      {error && (
        <p role="alert" className="flex gap-2 rounded-md border border-saffron-500/40 bg-saffron-100 p-3 text-sm text-saffron-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-raihan-500/30 bg-raihan-100 p-3 text-sm text-raihan-700">
          <Check className="h-4 w-4" aria-hidden="true" /> {notice}
        </p>
      )}

      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm font-medium text-ink">
            Week
            <select
              value={weekNo}
              onChange={(event) => setWeekNo(Number(event.target.value))}
              disabled={loading || assigningRow !== null}
              className="mt-1.5 block min-w-40 rounded-md border border-ink/20 bg-white px-3 py-2"
            >
              {WEEK_NUMBERS.map((number) => <option key={number} value={number}>Week {number}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            View and filter by
            <select
              value={viewBy}
              onChange={(event) => { setViewBy(event.target.value); setFilter(''); }}
              className="mt-1.5 block min-w-40 rounded-md border border-ink/20 bg-white px-3 py-2"
            >
              <option value="subject">Subject</option>
              <option value="teacher">Teacher</option>
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            {viewBy === 'teacher' ? 'Teacher' : 'Subject'}
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="mt-1.5 block min-w-48 rounded-md border border-ink/20 bg-white px-3 py-2"
            >
              <option value="">All {viewBy === 'teacher' ? 'teachers' : 'subjects'}</option>
              {values.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => loadWeek()}
            disabled={loading || assigningRow !== null}
            className="inline-flex items-center gap-2 rounded-md border border-ink/20 px-3 py-2 text-sm hover:bg-paper disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </div>

        {data && (
          <p className="mt-5 text-sm text-ink-soft">
            Week {data.weekNo} · {displayDate(data.startDate)} to {displayDate(data.endDate)} ·
            {' '}{visibleSessions.length} Raihan session(s) · {data.pending.length} pending selected-class session(s)
          </p>
        )}

        {loading ? (
          <p role="status" className="mt-6 flex items-center gap-2 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Loading final Raihan timetable…
          </p>
        ) : !data ? (
          <p className="mt-6 rounded-md bg-paper p-4 text-sm text-ink-soft">
            Build the schedule for this week in Allocation first.
          </p>
        ) : (
          <div className="mt-6 space-y-8">
            {days.length === 0 ? (
              <p className="rounded-md bg-paper p-4 text-sm text-ink-soft">
                No placed Raihan sessions are available for this view. Check pending sessions below.
              </p>
            ) : days.map(({ date, day, sessions }) => {
              const classes = [...new Set(sessions.map((session) => session.className))].sort();
              const bySlot = new Map(sessions.map((session) => [`${session.className}|${session.period}`, session]));
              return (
                <section key={date} aria-label={`${day}, ${displayDate(date)}`}>
                  <h2 className="mb-3 text-lg font-semibold text-ink">{day} · {displayDate(date)}</h2>
                  <div className="overflow-x-auto rounded-lg border border-ink/10">
                    <table className="min-w-[900px] w-full border-collapse text-sm">
                      <thead className="bg-paper">
                        <tr>
                          <th scope="col" className="sticky left-0 z-10 min-w-32 border-b border-ink/10 bg-paper p-3 text-start">Class</th>
                          {PERIODS.map((period) => (
                            <th scope="col" key={period} className="min-w-28 border-b border-ink/10 p-3 text-center">{period}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {classes.map((className) => (
                          <tr key={className} className="border-b border-ink/10 last:border-0">
                            <th scope="row" className="sticky left-0 z-10 bg-white p-3 text-start font-medium">{className}</th>
                            {PERIODS.map((period) => {
                              const session = bySlot.get(`${className}|${period}`);
                              const primary = viewBy === 'teacher'
                                ? session?.teacherName || session?.teacherId
                                : session?.subject;
                              const secondary = viewBy === 'teacher'
                                ? session?.subject
                                : session?.teacherName || session?.teacherId;
                              return (
                                <td key={period} className="border-s border-ink/5 p-2 text-center align-top">
                                  {session ? (
                                    <div className="rounded-md bg-raihan-100 px-2 py-1.5">
                                      <span className="block font-medium text-raihan-800">{primary}</span>
                                      <span className="block text-xs text-ink-soft">{secondary}</span>
                                    </div>
                                  ) : <span className="text-ink/20">—</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>

      {data?.pending?.length > 0 && (
        <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-xl font-semibold text-ink">Pending sessions · manual placement</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Choose a teacher already scheduled at Raihan, then a period free for both that teacher and the class on the teacher’s Raihan day.
          </p>
          <div className="mt-5 space-y-4">
            {data.pending.map((pending) => {
              const selection = selections[pending.rowNumber] || {};
              const teacher = data.teachers.find((item) => item.teacherId === selection.teacherId);
              const periods = teacher ? availablePeriods(pending, teacher) : [];
              return (
                <article key={pending.rowNumber} className="grid gap-3 rounded-lg border border-ink/10 bg-paper p-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_minmax(9rem,0.7fr)_auto] lg:items-center">
                  <div>
                    <p className="font-medium text-ink">{pending.className} · {pending.subject}</p>
                    <p className="text-xs text-ink-soft">
                      Source {pending.sourcePeriod || 'period unknown'} · {pending.diagnostic || 'Unplaced during schedule build'}
                    </p>
                  </div>
                  <label className="text-sm font-medium text-ink">
                    Raihan teacher
                    <select
                      value={selection.teacherId || ''}
                      onChange={(event) => {
                        const chosen = data.teachers.find((item) => item.teacherId === event.target.value);
                        const available = chosen ? availablePeriods(pending, chosen) : [];
                        setSelections((current) => ({
                          ...current,
                          [pending.rowNumber]: { teacherId: event.target.value, period: available[0] || '' },
                        }));
                      }}
                      className="mt-1 block w-full rounded-md border border-ink/20 bg-white px-2 py-2"
                    >
                      <option value="">Choose teacher</option>
                      {data.teachers.map((item) => (
                        <option key={item.teacherId} value={item.teacherId}>
                          {item.teacherName} · {item.day}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-ink">
                    Free period
                    <select
                      value={selection.period || ''}
                      onChange={(event) => setPendingSelection(pending.rowNumber, 'period', event.target.value)}
                      disabled={!teacher || periods.length === 0}
                      className="mt-1 block w-full rounded-md border border-ink/20 bg-white px-2 py-2 disabled:bg-paper"
                    >
                      <option value="">{teacher && periods.length ? 'Choose period' : 'No free periods'}</option>
                      {periods.map((period) => <option key={period} value={period}>{period}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => assignPending(pending)}
                    disabled={!selection.teacherId || !selection.period || assigningRow !== null}
                    className="rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {assigningRow === pending.rowNumber ? 'Assigning…' : 'Assign'}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
