import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, Loader2, RefreshCw } from 'lucide-react';
import { ApiError, UNKNOWN_ERROR_MESSAGE, apiCall } from '@/services/api';

export default function TempTeacherGridPage() {
  const [searchParams] = useSearchParams();
  const weekNo = Number(searchParams.get('week')) || null;
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [assignmentResult, setAssignmentResult] = useState(null);

  const loadProfiles = async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true);
    setError(null);
    try {
      const result = await apiCall('tempTeachers.list');
      if (!Array.isArray(result?.teachers)) throw new ApiError('BAD_RESPONSE');
      setProfiles(result.teachers);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadProfiles(false);
  }, []);

  const assignLags = async () => {
    if (!weekNo) return;
    setAssigning(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiCall('relocation.assignTemporary', { weekNo });
      if (!Array.isArray(result?.lags)) throw new ApiError('BAD_RESPONSE');
      setAssignmentResult(result);
      setMessage(
        result.assigned
          ? `Assigned ${result.assigned} lagging session${result.assigned === 1 ? '' : 's'} for Week ${weekNo}.`
          : `No sessions could be assigned for Week ${weekNo}.`,
      );
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-raihan-700">
          Schedule generation · Lag resolution
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
          Temporary teachers
        </h1>
        <p className="mt-3 max-w-3xl text-ink-soft">
          Enter temporary-teacher profiles directly in the <strong>Raihan_Temp_Teachers</strong>
          sheet for now. Refresh the list below after editing the sheet.
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
        <h2 className="text-lg font-semibold text-ink">Manual sheet entry</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Use one row per temporary teacher. Enter valid JSON in <code>Subjects_JSON</code> and
          <code> Availability_JSON</code>. Periods must be written as <code>Period 1</code> through
          <code> Period 9</code>; omit days when the teacher is unavailable.
        </p>
        <div className="mt-4 overflow-x-auto rounded-md bg-lapis-900 p-4 text-sm text-white">
          <p className="mb-2 font-medium">Availability_JSON example</p>
          <pre className="whitespace-pre-wrap break-all">{'{"Monday":["Period 1","Period 4"],"Wednesday":["Period 9"]}'}</pre>
        </div>
        <p className="mt-3 text-sm text-ink-soft">
          Example <code>Subjects_JSON</code>: <code>["Quran Kareem","Fiqh"]</code>. The sheet
          columns are <code>Temp_ID</code>, <code>Name</code>, <code>Phone</code>,
          <code> Subjects_JSON</code>, <code>Availability_JSON</code>, <code>Updated_At</code>,
          <code> Updated_By</code>. For a new profile, set <code>Temp_ID</code> to a unique value
          such as <code>TEMP_001</code>; Updated columns may be left blank.
        </p>
      </section>

      {weekNo && (
        <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-semibold text-ink">Resolve Week {weekNo} lags</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Assign compatible pending sessions using the subjects and availability saved in the sheet.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={assignLags}
              disabled={assigning || loading || profiles.length === 0}
              className="inline-flex items-center gap-2 rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {assigning && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {assigning ? 'Assigning sessions…' : 'Assign available temporary teachers'}
            </button>
            <Link
              to={`/outputs?week=${weekNo}`}
              className="inline-flex items-center rounded-md border border-raihan-700 px-4 py-2 text-sm font-medium text-raihan-700 hover:bg-raihan-100"
            >
              Open Raihan final timetable
            </Link>
          </div>
          {assignmentResult && assignmentResult.lags.length > 0 && (
            <div className="mt-4 rounded-md bg-saffron-100 p-4 text-sm text-saffron-700">
              <p className="font-semibold">{assignmentResult.lags.length} session(s) still need coverage.</p>
              <ul className="mt-2 list-disc ps-5">
                {assignmentResult.lags.map((lag, index) => (
                  <li key={`${lag.className}-${lag.subject}-${index}`}>
                    {lag.className} · {lag.subject} · {lag.diagnostic}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Profiles currently loaded from the sheet</h2>
            <p className="mt-1 text-sm text-ink-soft">After editing Raihan_Temp_Teachers, refresh to load the changes.</p>
          </div>
          <button
            type="button"
            onClick={() => loadProfiles()}
            disabled={refreshing}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-ink/20 px-3 py-2 text-sm hover:bg-paper disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh list
          </button>
        </div>
        {loading ? (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading sheet profiles…
          </p>
        ) : profiles.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">No temporary teacher profiles found. Add a row in Raihan_Temp_Teachers.</p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {profiles.map((teacher) => (
              <li key={teacher.id} className="rounded-md border border-ink/10 p-3">
                <p className="font-medium text-ink">{teacher.name} <span className="text-xs text-ink-soft">({teacher.id})</span></p>
                <p className="mt-1 text-sm text-ink-soft">Subjects: {teacher.subjects.join(', ')}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Availability:{' '}
                  {Object.entries(teacher.availability)
                    .filter(([, periods]) => periods.length)
                    .map(([day, periods]) => `${day}: ${periods.join(', ')}`)
                    .join(' · ') || 'none'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
