import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, Download, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import { ApiError, UNKNOWN_ERROR_MESSAGE, apiCall } from '@/services/api';
import { getActiveAllocationWeek, setActiveAllocationWeek } from '@/modules/allocation/allocationSession';

const WEEK_NUMBERS = Array.from({ length: 41 }, (_, index) => index + 1);

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] || '—';
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function downloadLags(lags, weekNo) {
  const headers = ['Class', 'Subject', 'Teacher_ID', 'Teacher_Name', 'Source_Date', 'Source_Period', 'Reason'];
  const rows = lags.map((lag) => [lag.className, lag.subject, lag.teacherId, lag.teacherName, lag.date, lag.sourcePeriod, lag.diagnostic]);
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Raihan_Lags_Week_${weekNo}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Breakdown({ title, counts }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">None</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.map(([label, count]) => (
            <li key={label} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate text-ink">{label}</span>
                <span className="font-medium text-ink">{count}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-paper">
                <div className="h-1.5 rounded-full bg-saffron-500" style={{ width: `${(count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LagDashboardPage() {
  const [searchParams] = useSearchParams();
  const [weekNo, setWeekNo] = useState(() => Number(searchParams.get('week')) || getActiveAllocationWeek());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [classFilter, setClassFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [reasonFilter, setReasonFilter] = useState('all');

  const load = useCallback(async (week) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall('allocation.getFinalWeek', { weekNo: week });
      if (!Array.isArray(result?.pending) || !Array.isArray(result?.sessions)) throw new ApiError('BAD_RESPONSE');
      setData(result);
    } catch (requestError) {
      setData(null);
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setActiveAllocationWeek(weekNo);
    setClassFilter('all');
    setSubjectFilter('all');
    setReasonFilter('all');
    setNotice(null);
    load(weekNo);
  }, [weekNo, load]);

  const lags = useMemo(() => data?.pending || [], [data]);
  const filtered = useMemo(() => lags.filter((lag) =>
    (classFilter === 'all' || lag.className === classFilter) &&
    (subjectFilter === 'all' || lag.subject === subjectFilter) &&
    (reasonFilter === 'all' || lag.diagnostic === reasonFilter),
  ), [lags, classFilter, subjectFilter, reasonFilter]);
  const placedByClass = useMemo(() => countBy(data?.sessions || [], 'className'), [data]);
  const lagsByClass = useMemo(() => countBy(lags, 'className'), [lags]);
  const options = (key) => [...new Set(lags.map((lag) => lag[key]).filter(Boolean))].sort();

  const autoAssign = async () => {
    setAssigning(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiCall('relocation.assignTemporary', { weekNo });
      setNotice(`${result?.assigned ?? 0} lesson(s) assigned to temporary teachers; ${result?.lags?.length ?? 0} still unplaced.`);
      await load(weekNo);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-raihan-700">Conflicts</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">Lag dashboard</h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          Raihan lessons that have no slot yet, with the reason. Place them by hand in the Raihan final
          timetable, or let saved temporary teachers take them.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-ink">
          Week
          <select
            value={weekNo}
            onChange={(event) => setWeekNo(Number(event.target.value))}
            disabled={loading || assigning}
            className="mt-1 block rounded-md border border-ink/20 bg-white px-3 py-2"
          >
            {WEEK_NUMBERS.map((number) => <option key={number} value={number}>Week {number}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => load(weekNo)}
          disabled={loading || assigning}
          className="inline-flex items-center gap-2 rounded-md border border-ink/20 px-3 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="flex gap-2 rounded-md border border-saffron-500/40 bg-saffron-100 p-3 text-sm text-saffron-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-raihan-500/30 bg-raihan-100 p-3 text-sm text-raihan-700">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}

      {loading ? (
        <p role="status" className="flex items-center gap-3 text-sm text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading Week {weekNo}
        </p>
      ) : data && (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              ['Unplaced Raihan lessons', lags.length],
              ['Placed at Raihan', data.sessions.length],
              ['Classes with lags', Object.keys(lagsByClass).length],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-ink/10 bg-white p-4">
                <dt className="text-xs text-ink-soft">{label}</dt>
                <dd className="text-2xl font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          {lags.length === 0 ? (
            <p className="rounded-lg border border-raihan-500/30 bg-raihan-100 p-4 text-sm text-raihan-700">
              Every Raihan lesson for Week {weekNo} has a slot.
            </p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Breakdown title="By reason" counts={countBy(lags, 'diagnostic')} />
                <Breakdown title="By subject" counts={countBy(lags, 'subject')} />
                <Breakdown
                  title="By class (unplaced / placed)"
                  counts={Object.fromEntries(Object.entries(lagsByClass).map(([className, count]) => [
                    `${className} · ${placedByClass[className] || 0} placed`, count,
                  ]))}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/outputs?week=${weekNo}`}
                  className="inline-flex items-center rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500"
                >
                  Place by hand in the final timetable
                </Link>
                <button
                  type="button"
                  onClick={autoAssign}
                  disabled={assigning}
                  className="inline-flex items-center gap-2 rounded-md border border-raihan-700 px-4 py-2 text-sm font-medium text-raihan-700 hover:bg-raihan-100 disabled:opacity-50"
                >
                  {assigning
                    ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    : <UserPlus className="h-4 w-4" aria-hidden="true" />}
                  Auto-assign temporary teachers
                </button>
                <Link
                  to={`/temp-teachers?week=${weekNo}`}
                  className="inline-flex items-center rounded-md border border-ink/20 px-4 py-2 text-sm font-medium text-ink hover:bg-paper"
                >
                  Manage temporary teachers
                </Link>
                <button
                  type="button"
                  onClick={() => downloadLags(filtered, weekNo)}
                  className="inline-flex items-center gap-2 rounded-md border border-ink/20 px-4 py-2 text-sm font-medium text-ink hover:bg-paper"
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> Download CSV
                </button>
              </div>

              <div className="flex flex-wrap gap-3">
                {[
                  ['Class', classFilter, setClassFilter, options('className')],
                  ['Subject', subjectFilter, setSubjectFilter, options('subject')],
                  ['Reason', reasonFilter, setReasonFilter, options('diagnostic')],
                ].map(([label, value, setValue, choices]) => (
                  <label key={label} className="text-sm font-medium text-ink">
                    {label}
                    <select
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      className="mt-1 block max-w-xs rounded-md border border-ink/20 bg-white px-3 py-2"
                    >
                      <option value="all">All</option>
                      {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white">
                <table className="w-full min-w-[800px] border-collapse text-sm">
                  <thead className="bg-paper">
                    <tr>
                      {['Class', 'Subject', 'Teacher', 'Source slot', 'Reason'].map((heading) => (
                        <th key={heading} className="p-3 text-start font-medium">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((lag) => (
                      <tr key={lag.rowNumber} className="border-t border-ink/10">
                        <td className="p-3">{lag.className}</td>
                        <td className="p-3">{lag.subject}</td>
                        <td className="p-3">{lag.teacherName ? `${lag.teacherName}${lag.teacherId ? ` (${lag.teacherId})` : ''}` : 'Department'}</td>
                        <td className="p-3">{lag.date} · {lag.sourcePeriod}</td>
                        <td className="p-3">{lag.diagnostic}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
