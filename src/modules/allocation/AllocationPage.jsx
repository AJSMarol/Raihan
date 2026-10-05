import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clipboard,
  Loader2,
  MessageCircle,
  RefreshCw,
  Save,
} from 'lucide-react';
import { ApiError, UNKNOWN_ERROR_MESSAGE, apiCall } from '@/services/api';

const WEEK_NUMBERS = Array.from({ length: 41 }, (_, index) => index + 1);

function displayDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function noticeFor(audience, week, teachers) {
  const classes = week.classes.join(', ');
  const period = `${displayDate(week.startDate)} to ${displayDate(week.endDate)}`;
  if (audience === 'students') {
    return [
      'RAIHAN CAMPUS NOTICE',
      `Week ${week.weekNo} (${period})`,
      `Classes attending Raihan: ${classes}.`,
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
    `Week ${week.weekNo} (${period})`,
    `Classes attending Raihan: ${classes}.`,
    'Assigned Raihan days:',
    travelDays,
    'Please review the advisory and coordinate any home-campus timetable adjustments.',
  ].join('\n');
}

export default function AllocationPage() {
  const [weekNo, setWeekNo] = useState(1);
  const [classes, setClasses] = useState([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedClasses, setSelectedClasses] = useState([]);
  const [savedSetup, setSavedSetup] = useState(null);
  const [advisory, setAdvisory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    setAdvisory(null);
    setAdvanced(false);
    setClasses([]);
    setStartDate('');
    setEndDate('');
    setSelectedClasses([]);
    setSavedSetup(null);

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
        };
        setClasses(classesFromSheet);
        setStartDate(selection.startDate);
        setEndDate(selection.endDate);
        setSelectedClasses(selection.classes);
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
    }),
    [weekNo, startDate, endDate, selectedClasses],
  );
  const savedKey = savedSetup ? JSON.stringify(savedSetup) : null;
  const currentKey = JSON.stringify(currentSetup);
  const setupIsSaved = savedKey === currentKey;
  const validDates = Boolean(startDate && endDate && startDate <= endDate);
  const canSave = validDates && selectedClasses.length > 0 && !loading && !saving;

  const toggleClass = (className) => {
    setNotice(null);
    setAdvisory(null);
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
      });
      setNotice(`Week ${weekNo} relocation setup saved.`);
      setAdvisory(null);
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
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setAnalyzing(false);
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

  const copyNotice = async (audience) => {
    const text = noticeFor(audience, currentSetup, advisory?.teachers ?? []);
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setNotice(`${audience === 'students' ? 'Student' : 'Asateza'} notice copied.`);
    } catch {
      setError('Could not copy the notice. Check clipboard permission and try again.');
    }
  };

  const openWhatsApp = (audience) => {
    const text = noticeFor(audience, currentSetup, advisory?.teachers ?? []);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const setupReady = validDates && selectedClasses.length > 0;
  const noticeEnabled = setupReady;

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
          Set the week, relocation dates, and affected classes. Schedule generation sanitizes
          duplicate sessions, consolidates selected classes onto each teacher’s Raihan weekday,
          and writes the result to the allocation sheets.
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
                setAdvanced(false);
                setNotice(null);
              }}
              disabled={loading || saving || analyzing || recording}
              className="mt-1.5 block w-full rounded-md border border-ink/20 bg-white px-3 py-2"
            />
          </label>
        </div>

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
            {analyzing ? 'Cleaning & building…' : 'Clean data & build schedule'}
          </button>
        </div>
      </section>

      {noticeEnabled && (
        <section aria-labelledby="notices-title" className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
          <h2 id="notices-title" className="text-lg font-semibold text-ink">Operational notices</h2>
          <p className="mt-1 text-sm text-ink-soft">Copy a ready-to-send notice or open WhatsApp with its text prefilled.</p>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {[
              { key: 'students', title: 'For students' },
              { key: 'asateza', title: 'For Asateza' },
            ].map(({ key, title }) => (
              <article key={key} className="rounded-lg border border-ink/10 bg-paper p-4">
                <h3 className="font-medium text-ink">{title}</h3>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-soft">
                  {noticeFor(key, currentSetup, advisory?.teachers ?? [])}
                </pre>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => copyNotice(key)} className="inline-flex items-center gap-2 rounded-md border border-ink/20 bg-white px-3 py-2 text-sm hover:bg-pearl">
                    <Clipboard className="h-4 w-4" aria-hidden="true" /> Copy notice
                  </button>
                  <button type="button" onClick={() => openWhatsApp(key)} className="inline-flex items-center gap-2 rounded-md bg-raihan-700 px-3 py-2 text-sm text-white hover:bg-raihan-500">
                    <MessageCircle className="h-4 w-4" aria-hidden="true" /> Open WhatsApp
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {advisory && (
        <section aria-labelledby="advisory-title" className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5">
            <p className="text-sm font-semibold uppercase tracking-wider text-raihan-700">Week {advisory.weekNo}</p>
            <h2 id="advisory-title" className="mt-1 text-xl font-semibold text-ink">Generated schedule and lag report</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Source rows with valid dates: {advisory.validDateRows ?? '—'}; rows in the selected
              window ({advisory.startDate} to {advisory.endDate}): {advisory.rowsInDateRange ?? '—'}.
              {' '}Sanitized {advisory.sourceRows} unique schedule sessions
              {advisory.duplicateRowsSkipped > 0
                ? ` (${advisory.duplicateRowsSkipped} repeated sessions removed).`
                : '.'}
              {' '}{advisory.allocatedRows} rows were written to Raihan_Allocations. Per-week
              calculations and lag diagnostics are in Raihan_Solver_Working. Schedule changes
              affect {advisory.alteredDayCount} date(s).
            </p>
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
                      Raihan day: {teacher.raihanDay}
                    </p>
                  </div>
                  <p className="mt-3 text-sm text-ink-soft">
                    {teacher.raihanSessions} selected-class sessions · {teacher.homeCommitmentsOnRaihanDay} home-campus sessions shifted off this day
                  </p>
                  {teacher.unplacedHomeCommitments > 0 && (
                    <p className="mt-1 text-sm font-medium text-saffron-700">
                      {teacher.unplacedHomeCommitments} home-campus session(s) could not be moved and are listed as lags.
                    </p>
                  )}
                </article>
              ))}
            </div>
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
                    {lag.className} · {lag.subject} · {lag.date} {lag.period} · {lag.diagnostic}
                  </li>
                ))}
              </ul>
              <Link
                to={`/temp-teachers?week=${advisory.weekNo}`}
                className="mt-4 inline-flex rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500"
              >
                Add temporary teachers and resolve lags
              </Link>
            </section>
          )}

          <div className="mt-6 flex flex-wrap gap-3 border-t border-ink/10 pt-5">
            <p className="w-full text-sm text-ink-soft">
              If the source timetable changed, update JHS_Raw_Data and rebuild. The generated
              schedule replaces only this week’s rows; allocations for other weeks are preserved.
            </p>
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
