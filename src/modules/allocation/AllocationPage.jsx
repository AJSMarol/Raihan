import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Download,
  Loader2,
  Printer,
  RefreshCw,
  Save,
} from 'lucide-react';
import { ApiError, UNKNOWN_ERROR_MESSAGE, apiCall } from '@/services/api';
import {
  clearAllocationAdvisory,
  getActiveAllocationWeek,
  getAllocationAdvisory,
  setActiveAllocationWeek,
  setAllocationAdvisory,
} from './allocationSession';

const WEEK_NUMBERS = Array.from({ length: 41 }, (_, index) => index + 1);
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdaysInRange(startDate, endDate) {
  const days = new Set();
  if (!startDate || !endDate) return [];
  for (let date = new Date(`${startDate}T00:00:00Z`); date <= new Date(`${endDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    days.add(WEEKDAYS[(date.getUTCDay() + 6) % 7]);
  }
  return WEEKDAYS.filter((day) => days.has(day));
}

function downloadCsv(headers, rows, filename) {
  const csv = [headers, ...rows].map((row) => row.map((value) => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Shows sheet rows compactly: [5, 6, 7, 9] -> "5–7, 9". */
function formatRows(rows) {
  const sorted = [...new Set((rows || []).map(Number))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    parts.push(end > i ? `${sorted[i]}–${sorted[end]}` : String(sorted[i]));
    i = end;
  }
  return parts.join(', ');
}

const SWAP_ACTION_LABELS = {
  SWAP: 'Swap with another lesson of this class',
  MOVE_TO_FREE_PERIOD: 'Move to a free period',
  GROUP_COVER: 'Group lesson continues without this teacher',
  NEEDS_SUBSTITUTE: 'No swap found: arrange a substitute',
};

function describeOption(option) {
  if (!option) return '';
  const target = `${option.target.day} ${option.target.date} ${option.target.period}`;
  return option.swapWith
    ? `→ ${target}, swapping with ${option.swapWith.subject} (${option.swapWith.teachers || 'department'})`
    : `→ ${target} (free period)`;
}

function downloadSwapSuggestions(suggestions, weekNo) {
  downloadCsv(
    ['Teacher_ID', 'Teacher_Name', 'Raihan_Slot', 'Reason', 'Campus_Class', 'Campus_Subject', 'Campus_Day',
      'Campus_Date', 'Campus_Period', 'JHS_Raw_Data_Row(s)', 'Suggested_Action', 'Move_To_Date', 'Move_To_Period',
      'Swap_With_Subject', 'Swap_With_Teachers', 'Swap_With_Row(s)', 'Alternatives'],
    suggestions.map((item) => {
      const first = item.options?.[0];
      return [
        item.teacherId, item.teacherName, item.raihanSlot, item.reason, item.lesson.className, item.lesson.subject,
        item.lesson.day, item.lesson.date, item.lesson.period, formatRows(item.lesson.sourceRows),
        SWAP_ACTION_LABELS[item.action] || item.action, first?.target.date || '', first?.target.period || '',
        first?.swapWith?.subject || '', first?.swapWith?.teachers || '', formatRows(first?.swapWith?.sourceRows),
        (item.options || []).slice(1).map(describeOption).join(' | '),
      ];
    }),
    `Raihan_Campus_Swap_Suggestions_Week_${weekNo}.csv`,
  );
}

function downloadLocalCampusCollisionReport(collisions, weekNo) {
  const headers = [
    'Teacher_ID', 'Teacher_Name', 'Raihan_Day', 'Raihan_Date', 'Raihan_Period',
    'Raihan_Class', 'Raihan_Subject', 'JHS_Raw_Data_Row(s)', 'Collision_Reason', 'Local_Campus_Day',
    'Local_Campus_Date', 'Local_Campus_Period', 'Local_Campus_Class', 'Local_Campus_Subject',
  ];
  const rows = collisions.map((collision) => [
    collision.teacherId,
    collision.teacherName,
    collision.raihanDay,
    collision.raihanDate,
    collision.raihanPeriod,
    collision.raihanClass,
    collision.raihanSubject,
    (collision.sourceRows || []).join(', '),
    collision.collisionReason,
    collision.localDay,
    collision.localDate,
    collision.localPeriod,
    collision.localClass,
    collision.localSubject,
  ]);
  const csv = [headers, ...rows].map((row) => row.map((value) => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Raihan_Local_Campus_Collisions_Week_${weekNo}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function AllocationPage() {
  const [weekNo, setWeekNo] = useState(getActiveAllocationWeek);
  const [classes, setClasses] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedClasses, setSelectedClasses] = useState([]);
  const [includeSaturday, setIncludeSaturday] = useState(false);
  const [printTarget, setPrintTarget] = useState('clashes');
  const [savedSetup, setSavedSetup] = useState(null);
  const [advisory, setAdvisory] = useState(() => getAllocationAdvisory(getActiveAllocationWeek()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingTeacherDays, setSavingTeacherDays] = useState(false);
  const [teacherDays, setTeacherDays] = useState({});
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    setAdvanced(false);
    setClasses([]);
    setStartDate('');
    setEndDate('');
    setSelectedClasses([]);
    setIncludeSaturday(false);
    setSavedSetup(null);
    setActiveAllocationWeek(weekNo);
    setAdvisory(getAllocationAdvisory(weekNo));

    apiCall('relocation.getWeek', { weekNo })
      .then((result) => {
        if (!active) return;
        if (!Array.isArray(result?.classes)) throw new ApiError('BAD_RESPONSE');
        const classesFromSheet = result.classes;
        const week = result.week;
        const selection = {
          weekNo,
          startDate: week?.startDate ?? '',
          endDate: week?.endDate ?? '',
          classes: week?.classes ?? [],
          includeSaturday: Boolean(week?.includeSaturday),
        };
        setClasses(classesFromSheet);
        setStartDate(selection.startDate);
        setEndDate(selection.endDate);
        setSelectedClasses(selection.classes);
        setIncludeSaturday(selection.includeSaturday);
        setSavedSetup(week ? selection : null);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
        setClasses([]);
        setSavedSetup(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [weekNo]);

  const currentSetup = useMemo(
    () => ({
      weekNo,
      startDate,
      endDate,
      classes: [...selectedClasses].sort(),
      includeSaturday,
    }),
    [weekNo, startDate, endDate, selectedClasses, includeSaturday],
  );
  const savedKey = savedSetup ? JSON.stringify(savedSetup) : null;
  const currentKey = JSON.stringify(currentSetup);
  const setupIsSaved = savedKey === currentKey;
  const validDates = Boolean(startDate && endDate && startDate <= endDate);
  const canSave = validDates && selectedClasses.length > 0 && !loading && !saving;

  const toggleClass = (className) => {
    setNotice(null);
    setAdvisory(null);
    clearAllocationAdvisory(weekNo);
    setAdvanced(false);
    setSelectedClasses((current) =>
      current.includes(className)
        ? current.filter((name) => name !== className)
        : [...current, className],
    );
  };

  const saveSetup = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiCall('relocation.saveWeek', currentSetup);
      const savedWeek = result?.week;
      if (!savedWeek || !Array.isArray(savedWeek.classes)) throw new ApiError('BAD_RESPONSE');
      setSavedSetup({
        weekNo: savedWeek.weekNo,
        startDate: savedWeek.startDate,
        endDate: savedWeek.endDate,
        classes: [...savedWeek.classes].sort(),
        includeSaturday: Boolean(savedWeek.includeSaturday),
      });
      setNotice(`Week ${weekNo} relocation setup saved.`);
      setAdvisory(null);
      clearAllocationAdvisory(weekNo);
      setAdvanced(false);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    setAdvanced(false);
    try {
      const result = await apiCall('relocation.analyzeWeek', { weekNo });
      if (!Array.isArray(result?.teachers)) throw new ApiError('BAD_RESPONSE');
      setAdvisory(result);
      setAllocationAdvisory(weekNo, result);
      setTeacherDays(Object.fromEntries(result.teachers.map((teacher) => [teacher.teacherId, teacher.raihanDay])));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setAnalyzing(false);
    }
  };

  const applyTeacherDays = async () => {
    if (!advisory?.teachers?.length) return;
    setSavingTeacherDays(true);
    setError(null);
    setNotice(null);
    try {
      await apiCall('relocation.saveTeacherDays', {
        weekNo,
        assignments: advisory.teachers.map((teacher) => ({
          teacherId: teacher.teacherId,
          day: teacherDays[teacher.teacherId] || teacher.raihanDay,
        })),
      });
      const result = await apiCall('relocation.analyzeWeek', { weekNo });
      if (!Array.isArray(result?.teachers)) throw new ApiError('BAD_RESPONSE');
      setAdvisory(result);
      setAllocationAdvisory(weekNo, result);
      setTeacherDays(Object.fromEntries(result.teachers.map((teacher) => [teacher.teacherId, teacher.raihanDay])));
      setNotice('Teacher Raihan days saved. The schedule was rebuilt using your choices.');
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setSavingTeacherDays(false);
    }
  };

  const refreshAfterSheetUpdate = async () => {
    setRecording(true);
    setError(null);
    setNotice(null);
    try {
      await apiCall('relocation.recordAction', {
        weekNo,
        action: 'RAW_DATA_UPDATED',
      });
      const result = await apiCall('relocation.analyzeWeek', { weekNo });
      if (!Array.isArray(result?.teachers)) throw new ApiError('BAD_RESPONSE');
      setAdvisory(result);
      setAllocationAdvisory(weekNo, result);
      setTeacherDays(Object.fromEntries(result.teachers.map((teacher) => [teacher.teacherId, teacher.raihanDay])));
      setNotice('JHS_Raw_Data refreshed. Review the updated advisory below.');
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setRecording(false);
    }
  };

  const proceed = async () => {
    setRecording(true);
    setError(null);
    setNotice(null);
    try {
      await apiCall('relocation.recordAction', {
        weekNo,
        action: 'CHANGES_DONE_PROCEED',
        details: { advisoryReviewed: Boolean(advisory) },
      });
      setAdvanced(true);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setRecording(false);
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-raihan-700">
          Phase 1 · Relocation setup
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
          Raihan relocation
        </h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          Set the week, dates, and the classes going to Raihan for the whole week. The builder places
          every Raihan lesson, keeps each teacher to as few Raihan days as possible, and keeps a
          two-hour travel gap from their campus lessons. Campus lessons that still break the gap are
          listed with suggested swaps; JHS_Raw_Data is never edited automatically.
        </p>
      </header>

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

      <section aria-labelledby="relocation-setup" className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-6">
          <h2 id="relocation-setup" className="text-lg font-semibold text-ink">Relocation window</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Choose a week ID, date range, and one or more classes.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <label className="text-sm font-medium text-ink">
            Week number
            <select
              value={weekNo}
              onChange={(event) => setWeekNo(Number(event.target.value))}
              disabled={loading || saving || analyzing || recording}
              className="mt-1.5 block w-full rounded-md border border-ink/20 bg-white px-3 py-2"
            >
              {WEEK_NUMBERS.map((number) => (
                <option key={number} value={number}>Week {number}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                setAdvisory(null);
                clearAllocationAdvisory(weekNo);
                setAdvanced(false);
                setNotice(null);
              }}
              disabled={loading || saving || analyzing || recording}
              className="mt-1.5 block w-full rounded-md border border-ink/20 bg-white px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium text-ink">
            End date
            <input
              type="date"
              min={startDate || undefined}
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                setAdvisory(null);
                clearAllocationAdvisory(weekNo);
                setAdvanced(false);
                setNotice(null);
              }}
              disabled={loading || saving || analyzing || recording}
              className="mt-1.5 block w-full rounded-md border border-ink/20 bg-white px-3 py-2"
            />
          </label>
        </div>

        <label className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={includeSaturday}
            onChange={(event) => {
              setIncludeSaturday(event.target.checked);
              setAdvisory(null);
              clearAllocationAdvisory(weekNo);
              setAdvanced(false);
              setNotice(null);
            }}
            disabled={loading || saving || analyzing || recording}
            className="h-4 w-4 rounded border-ink/30 text-raihan-700 focus:ring-raihan-500"
          />
          Raihan is open on Saturday this week
        </label>
        <p className="mt-1 text-xs text-ink-soft">
          Off: Raihan lessons use Monday–Friday only. Each class has 9 Raihan periods a day (Period 2–10).
        </p>

        <fieldset className="mt-7">
          <legend className="text-sm font-medium text-ink">Classes going to Raihan</legend>
          <p className="mt-1 text-sm text-ink-soft">Select one or more classes from JHS_Raw_Data.</p>
          {loading ? (
            <p role="status" className="mt-4 flex items-center gap-3 text-sm text-ink-soft">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Loading classes and Week {weekNo}
            </p>
          ) : classes.length === 0 ? (
            <p className="mt-4 rounded-md bg-paper p-4 text-sm text-ink-soft">
              No classes found in JHS_Raw_Data.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {classes.map((className) => {
                const checked = selectedClasses.includes(className);
                return (
                  <label
                    key={className}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm ${
                      checked
                        ? 'border-raihan-500 bg-raihan-100 text-raihan-700'
                        : 'border-ink/15 bg-white text-ink hover:border-lapis-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleClass(className)}
                      disabled={saving || analyzing || recording}
                      className="h-4 w-4 rounded border-ink/30 text-raihan-700 focus:ring-raihan-500"
                    />
                    {className}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>

        {!validDates && startDate && endDate && (
          <p className="mt-3 text-sm text-saffron-700">End date must be on or after start date.</p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={saveSetup}
            disabled={!canSave || setupIsSaved}
            className="inline-flex items-center gap-2 rounded-md bg-lapis-600 px-4 py-2 text-sm font-medium text-white hover:bg-lapis-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saving ? 'Saving…' : setupIsSaved ? 'Setup saved' : 'Save week setup'}
          </button>
          <button
            type="button"
            onClick={analyze}
            disabled={!setupIsSaved || saving || analyzing || recording}
            className="inline-flex items-center gap-2 rounded-md border border-lapis-600 px-4 py-2 text-sm font-medium text-lapis-700 hover:bg-lapis-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {analyzing ? 'Prioritizing Raihan & building…' : 'Prioritize Raihan & build schedule'}
          </button>
        </div>
      </section>

      {advisory && (
        <section aria-labelledby="advisory-title" className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5">
            <p className="text-sm font-semibold uppercase tracking-wider text-raihan-700">Week {advisory.weekNo}</p>
            <h2 id="advisory-title" className="mt-1 text-xl font-semibold text-ink">Raihan-first schedule and campus collision report</h2>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ['Raihan lessons placed', advisory.raihanPlaced ?? '—'],
                ['Still unplaced', advisory.lagCount ?? 0],
                ['Lead teachers', advisory.teachers?.length ?? 0],
                ['Teacher travel days', advisory.teacherDayCount ?? '—'],
                ['Travel-gap clashes', advisory.localCampusCollisionCount ?? 0],
                ['Not held this week', advisory.notHeldCount ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md bg-paper p-3">
                  <dt className="text-xs text-ink-soft">{label}</dt>
                  <dd className="text-xl font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-ink-soft">
              {advisory.rowsInDateRange ?? '—'} JHS_Raw_Data rows in {advisory.startDate} to {advisory.endDate}
              {' '}collapsed to {advisory.sourceRows} lessons ({advisory.duplicateRowsSkipped || 0} repeated rows merged).
              {' '}Raihan days: {(advisory.raihanDates || []).map((item) => item.day.slice(0, 3)).join(', ') || '—'}
              {' '}· periods {advisory.raihanPeriods?.[0] ?? 'Period 2'}–{advisory.raihanPeriods?.[advisory.raihanPeriods.length - 1] ?? 'Period 10'}.
              {advisory.departmentStaffed > 0 && ` ${advisory.departmentStaffed} placed lesson(s) have no named teacher and are staffed by their department.`}
              {' '}{advisory.allocatedRows} rows written to Raihan_Allocations; details in Raihan_Solver_Working.
            </p>
            {advisory.capacityPerClass > 0 && Object.entries(advisory.demandByClass || {})
              .some(([, count]) => count > advisory.capacityPerClass) && (
              <p role="alert" className="mt-3 rounded-md border border-saffron-500/40 bg-saffron-100 p-3 text-sm text-saffron-800">
                Not enough Raihan periods this week: each class has {advisory.capacityPerClass} slots, but{' '}
                {Object.entries(advisory.demandByClass)
                  .filter(([, count]) => count > advisory.capacityPerClass)
                  .map(([className, count]) => `${className} needs ${count}`).join(', ')}.
                {!advisory.includeSaturday && ' Opening Raihan on Saturday adds 9 periods per class.'}
              </p>
            )}
            {advisory.skippedRows &&
              Object.values(advisory.skippedRows).reduce((sum, count) => sum + count, 0) > 0 && (
                <p role="status" className="mt-3 rounded-md bg-saffron-100 p-3 text-sm text-saffron-700">
                  Some JHS_Raw_Data rows were skipped due to invalid or missing schedule fields.
                  The breakdown below distinguishes unparsed dates from invalid schedule rows in
                  the selected date window.
                </p>
              )}
            {advisory.skippedRows &&
              Object.entries(advisory.skippedRows).some(([, count]) => count > 0) && (
                <div role="status" className="mt-3 rounded-md bg-saffron-100 p-3 text-sm text-saffron-700">
                  <p className="font-semibold">Skipped-row breakdown</p>
                  <ul className="mt-1 list-inside list-disc">
                    {Object.entries(advisory.skippedRows)
                      .filter(([, count]) => count > 0)
                      .map(([field, count]) => <li key={field}>{field}: {count}</li>)}
                  </ul>
                  {advisory.invalidDateSamples?.length > 0 && (
                    <div className="mt-2">
                      <p className="font-medium">First unparsed Date-column values:</p>
                      <ul className="mt-1 list-inside list-disc">
                        {advisory.invalidDateSamples.map((sample) => (
                          <li key={sample.row}>
                            Row {sample.row}: raw “{sample.rawValue || '(blank)'}”; displayed
                            “{sample.displayedValue || '(blank)'}”
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {advisory.invalidScheduleSamples?.length > 0 && (
                    <div className="mt-2">
                      <p className="font-medium">Examples of rows with unrecognized schedule fields:</p>
                      <ul className="mt-1 space-y-1">
                        {advisory.invalidScheduleSamples.map((sample) => (
                          <li key={sample.row}>
                            Row {sample.row}: Period raw “{sample.periodRaw || '(blank)'}”, displayed
                            “{sample.periodDisplayed || '(blank)'}”; teacher raw
                            “{sample.teacherRaw || '(blank)'}”, displayed
                            “{sample.teacherDisplayed || '(blank)'}”
                            {sample.invalidSubject ? '; Subject is blank' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            {advisory.rowsInDateRange === 0 && advisory.validDateRows > 0 && (
              <div role="status" className="mt-3 rounded-md bg-saffron-100 p-3 text-sm text-saffron-700">
                <p className="font-semibold">
                  Parsed dates in JHS_Raw_Data: {advisory.earliestValidDate} to {advisory.latestValidDate}.
                  They don’t overlap the selected date window.
                </p>
                <ul className="mt-1 list-inside list-disc">
                  {advisory.validDateSamples?.map((sample) => (
                    <li key={sample.row}>
                      Row {sample.row}: “{sample.displayedValue}” parsed as {sample.parsedDate}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {advisory.teachers.length === 0 ? (
            <p className="rounded-md bg-paper p-4 text-sm text-ink-soft">
              {advisory.rowsInDateRange === 0
                ? 'No JHS_Raw_Data rows have valid dates inside this selected date window. Check the start/end dates against the Date column.'
                : 'No valid teacher assignments were found for the selected classes and date window. Check the skipped-row breakdown and class selection.'}
            </p>
          ) : (
            <div className="space-y-4">
              <section className="rounded-lg border border-raihan-500/30 bg-raihan-50 p-4">
                <h3 className="font-semibold text-ink">Confirm each teacher’s Raihan day</h3>
                <p className="mt-1 text-sm text-ink-soft">
                  The builder gives each teacher as few Raihan days as possible (up to nine periods a day) and prefers days with fewer campus lessons. Choosing a day here overrides the builder for that teacher.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {advisory.teachers.map((teacher) => (
                    <label key={teacher.teacherId} className="rounded-md border border-ink/10 bg-white p-3 text-sm font-medium text-ink">
                      {teacher.teacherName} <span className="text-xs text-ink-soft">({teacher.teacherId})</span>
                      <select
                        value={teacherDays[teacher.teacherId] || teacher.raihanDay}
                        onChange={(event) => setTeacherDays((current) => ({
                          ...current,
                          [teacher.teacherId]: event.target.value,
                        }))}
                        disabled={savingTeacherDays || analyzing}
                        className="mt-1 block w-full rounded-md border border-ink/20 bg-white px-2 py-2"
                      >
                        {(advisory.raihanDates?.map((item) => item.day) ||
                          weekdaysInRange(advisory.startDate, advisory.endDate)).map((day) => (
                          <option key={day} value={day}>
                            {day} · {teacher.homeCommitmentsByDay?.[day] || 0} local-campus period(s)
                            {day === teacher.raihanDay ? ' · suggested' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={applyTeacherDays}
                  disabled={savingTeacherDays || analyzing || !advisory.teachers.some(
                    (teacher) => (teacherDays[teacher.teacherId] || teacher.raihanDay) !== teacher.raihanDay,
                  )}
                  className="mt-4 inline-flex items-center gap-2 rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingTeacherDays && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {savingTeacherDays ? 'Saving days and rebuilding…' : 'Apply teacher days and rebuild'}
                </button>
                <p className="mt-3 text-sm text-ink-soft">
                  Building the schedule does not move or edit local-campus lessons. Use the collision report below to decide which local-campus periods to shuffle after finalizing the Raihan timetable, then paste the updated timetable into JHS_Raw_Data and rebuild.
                </p>
              </section>
              {advisory.teachers.map((teacher) => (
                <article key={teacher.teacherId} className="rounded-lg border border-ink/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-ink">{teacher.teacherName}</h3>
                      <p className="text-sm text-ink-soft">
                        ID {teacher.teacherId} · Classes {teacher.classes.join(', ')}
                      </p>
                    </div>
                    <p className="rounded-full bg-raihan-100 px-3 py-1 text-sm font-medium text-raihan-700">
                      Raihan day{teacher.raihanDays?.length === 1 ? '' : 's'}: {(teacher.raihanDays || [teacher.raihanDay]).join(' + ')}
                    </p>
                  </div>
                  <p className="mt-3 text-sm text-ink-soft">
                    {teacher.raihanSessions} Raihan session(s) · {teacher.localCampusCollisionCount || 0} local-campus collision(s) to review
                  </p>
                </article>
              ))}
            </div>
          )}

          {advisory.teachers.length > 0 && (
            <section className={`${printTarget === 'clashes' ? 'print-collision-report ' : ''}mt-6 rounded-lg border border-saffron-500/30 bg-saffron-50 p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-ink">Campus lessons that break the travel gap</h3>
                  <p className="mt-1 text-sm text-ink-soft">
                    Week {advisory.weekNo} · {advisory.startDate} to {advisory.endDate} · {advisory.localCampusCollisionCount || 0} campus lesson(s).
                    A teacher needs at least {(advisory.travelGapMinutes || 120) / 60} hours between a campus lesson and a Raihan lesson on the same day. Classes at Raihan are away all week, so their own campus periods are free and are not listed.
                  </p>
                </div>
                <div className="no-print flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPrintTarget('clashes');
                      setTimeout(() => window.print(), 0);
                    }}
                    disabled={!advisory.localCampusCollisions?.length}
                    className="inline-flex items-center gap-2 rounded-md border border-ink/20 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
                  >
                    <Printer className="h-4 w-4" aria-hidden="true" />
                    Print / Save as PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadLocalCampusCollisionReport(advisory.localCampusCollisions || [], weekNo)}
                    disabled={!advisory.localCampusCollisions?.length}
                    className="inline-flex items-center gap-2 rounded-md border border-ink/20 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download CSV
                  </button>
                </div>
              </div>
              {!advisory.localCampusCollisions?.length ? (
                <p className="mt-4 rounded-md bg-white p-3 text-sm text-ink-soft">
                  Every teacher keeps the travel gap between campus and Raihan.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-md border border-ink/10 bg-white">
                  <table className="w-full min-w-[1000px] border-collapse text-sm">
                    <thead className="bg-paper">
                      <tr>
                        {['Teacher', 'Raihan slot', 'Raihan class · subject', 'JHS row(s)', 'Collision reason', 'Local-campus class · subject', 'Local-campus slot to review'].map((heading) => (
                          <th key={heading} className="p-2 text-start font-medium">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {advisory.localCampusCollisions.map((collision, index) => (
                        <tr key={`${collision.teacherId}-${collision.raihanDate}-${collision.raihanPeriod}-${collision.localClass}-${index}`} className="border-t border-ink/10">
                          <td className="p-2">{collision.teacherName} ({collision.teacherId})</td>
                          <td className="p-2">{collision.raihanDay} · {collision.raihanDate} · {collision.raihanPeriod}</td>
                          <td className="p-2">{collision.raihanClass} · {collision.raihanSubject}</td>
                          <td className="p-2">{formatRows(collision.sourceRows)}</td>
                          <td className="p-2">{collision.collisionReason}</td>
                          <td className="p-2">{collision.localClass} · {collision.localSubject}</td>
                          <td className="p-2">{collision.localDay} · {collision.localDate} · {collision.localPeriod}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {advisory.campusSwapSuggestions?.length > 0 && (
            <section className={`${printTarget === 'swaps' ? 'print-collision-report ' : ''}mt-6 rounded-lg border border-lapis-400/40 bg-white p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-ink">Suggested campus swaps</h3>
                  <p className="mt-1 max-w-3xl text-sm text-ink-soft">
                    One suggestion per clashing campus lesson. Suggestions fit together: applying all
                    of them in JHS_Raw_Data keeps every class and teacher single-booked and clears the
                    clashes they address. Approve them, update JHS_Raw_Data, then rebuild to confirm.
                  </p>
                  <p className="mt-2 text-sm font-medium text-ink">
                    {Object.entries(advisory.campusSwapSuggestions.reduce((counts, item) => ({
                      ...counts, [item.action]: (counts[item.action] || 0) + 1,
                    }), {})).map(([action, count]) => `${count} × ${SWAP_ACTION_LABELS[action] || action}`).join(' · ')}
                  </p>
                </div>
                <div className="no-print flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPrintTarget('swaps');
                      setTimeout(() => window.print(), 0);
                    }}
                    className="inline-flex items-center gap-2 rounded-md border border-ink/20 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-paper"
                  >
                    <Printer className="h-4 w-4" aria-hidden="true" />
                    Print
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadSwapSuggestions(advisory.campusSwapSuggestions, weekNo)}
                    className="inline-flex items-center gap-2 rounded-md border border-ink/20 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-paper"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download CSV
                  </button>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto rounded-md border border-ink/10">
                <table className="w-full min-w-[1000px] border-collapse text-sm">
                  <thead className="bg-paper">
                    <tr>
                      {['Teacher', 'Raihan slot', 'Campus lesson to change', 'JHS row(s)', 'Suggestion', 'Alternatives'].map((heading) => (
                        <th key={heading} className="p-2 text-start font-medium">{heading}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {advisory.campusSwapSuggestions.map((item, index) => (
                      <tr key={`${item.teacherId}-${item.lesson.date}-${item.lesson.period}-${index}`} className="border-t border-ink/10 align-top">
                        <td className="p-2">{item.teacherName} ({item.teacherId})</td>
                        <td className="p-2">{item.raihanSlot}<span className="block text-xs text-ink-soft">{item.reason}</span></td>
                        <td className="p-2">{item.lesson.className} · {item.lesson.subject}<span className="block text-xs text-ink-soft">{item.lesson.day} {item.lesson.date} {item.lesson.period}</span></td>
                        <td className="p-2">{formatRows(item.lesson.sourceRows)}</td>
                        <td className="p-2">
                          <span className="font-medium">{SWAP_ACTION_LABELS[item.action] || item.action}</span>
                          <span className="block text-xs text-ink-soft">{item.note || describeOption(item.options?.[0])}</span>
                          {item.options?.[0]?.swapWith && (
                            <span className="block text-xs text-ink-soft">Partner row(s): {formatRows(item.options[0].swapWith.sourceRows)}</span>
                          )}
                        </td>
                        <td className="p-2 text-xs text-ink-soft">
                          {(item.options || []).slice(1).map((option, optionIndex) => (
                            <span key={optionIndex} className="block">{describeOption(option)}</span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {advisory.notHeld?.length > 0 && (
            <details className="mt-6 rounded-lg border border-ink/10 bg-paper p-4 text-sm">
              <summary className="cursor-pointer font-medium text-ink">
                {advisory.notHeldCount} lesson(s) of Raihan classes are not held this week
              </summary>
              <p className="mt-2 text-ink-soft">
                These books are not taught at Raihan. Khaimat Riyadat runs at Raihan outside the timetable and is not listed.
              </p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {advisory.notHeld.map((item, index) => (
                  <li key={`${item.className}-${item.date}-${item.period}-${index}`}>
                    {item.className} · {item.subject}{item.book ? ` (${item.book})` : ''} · {item.date} {item.period}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {advisory.lags?.length > 0 && (
            <section aria-labelledby="lag-report" className="mt-6 rounded-lg border border-saffron-500/30 bg-saffron-100 p-4">
              <h3 id="lag-report" className="font-semibold text-saffron-700">
                {advisory.lagCount} session(s) need additional coverage
              </h3>
              <p className="mt-1 text-sm text-saffron-700">
                Add temporary teachers with matching subjects and available periods; saved profiles
                can be reused for future weeks.
              </p>
              {Object.keys(advisory.lagBySubject || {}).length > 0 && (
                <ul className="mt-3 list-disc ps-5 text-sm text-saffron-700">
                  {Object.entries(advisory.lagBySubject).map(([subject, count]) => (
                    <li key={subject}>{subject}: {count} uncovered period(s)</li>
                  ))}
                </ul>
              )}
              <ul className="mt-3 space-y-1 text-sm text-ink">
                {advisory.lags.map((lag, index) => (
                  <li key={`${lag.className}-${lag.subject}-${lag.date}-${index}`}>
                    {lag.className} · {lag.subject} · {lag.teacherName || 'no teacher'} · source {lag.date} {lag.period} · {lag.diagnostic}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={`/lag?week=${advisory.weekNo}`}
                  className="inline-flex rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500"
                >
                  Open lag dashboard
                </Link>
                <Link
                  to={`/temp-teachers?week=${advisory.weekNo}`}
                  className="inline-flex rounded-md border border-raihan-700 px-4 py-2 text-sm font-medium text-raihan-700 hover:bg-raihan-100"
                >
                  Enter temporary teachers
                </Link>
              </div>
            </section>
          )}

          <div className="mt-6 flex flex-wrap gap-3 border-t border-ink/10 pt-5">
            <p className="w-full text-sm text-ink-soft">
              If the source timetable changed, update JHS_Raw_Data and rebuild. The generated
              schedule replaces only this week’s rows; allocations for other weeks are preserved.
            </p>
            <Link
              to={`/outputs?week=${advisory.weekNo}`}
              className="inline-flex items-center gap-2 rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500"
            >
              Open Raihan final timetable
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={refreshAfterSheetUpdate}
              disabled={recording || analyzing}
              className="inline-flex items-center gap-2 rounded-md border border-ink/20 px-4 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-50"
            >
              {recording ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              I updated JHS_Raw_Data — rebuild schedule
            </button>
            <button
              type="button"
              onClick={proceed}
              disabled={recording}
              className="inline-flex items-center gap-2 rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500 disabled:opacity-50"
            >
              Changes Done — Proceed <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            Proceed is non-blocking: it records the decision for Week {weekNo}; it does not
            require another upload.
          </p>
        </section>
      )}

      {advanced && (
        <section role="status" className="rounded-xl border border-raihan-500/30 bg-raihan-100 p-5 sm:p-7">
          <p className="text-sm font-semibold uppercase tracking-wider text-raihan-700">
            Week {weekNo} · Phase 1 complete
          </p>
          <h2 className="mt-2 text-xl font-semibold text-ink">Ready for the next phase</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Your proceed decision is logged. The generated timetable and any outstanding lags are
            saved for Week {weekNo}.
          </p>
        </section>
      )}

      <section aria-label="Future phases" className="text-sm text-ink-faint">
        <p>Still planned: print-ready crosstab, PDF export, and personalized teacher distribution.</p>
        <p className="mt-1">Future academic operations: syllabus tracking, weekly feedback, and event overrides.</p>
      </section>
    </section>
  );
}
