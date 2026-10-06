import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, Loader2, Save } from 'lucide-react';
import { ApiError, UNKNOWN_ERROR_MESSAGE, apiCall } from '@/services/api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PERIODS = Array.from({ length: 9 }, (_, index) => `P${index + 1}`);
function emptyProfile() {
  return {
    id: '',
    name: '',
    phone: '',
    subjects: '',
    availability: Object.fromEntries(DAYS.map((day) => [day, []])),
  };
}

export default function TempTeacherGridPage() {
  const [searchParams] = useSearchParams();
  const weekNo = Number(searchParams.get('week')) || null;
  const [profiles, setProfiles] = useState([]);
  const [profile, setProfile] = useState(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [assignmentResult, setAssignmentResult] = useState(null);
  const paintMode = useRef(null);

  const loadProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall('tempTeachers.list');
      if (!Array.isArray(result?.teachers)) throw new ApiError('BAD_RESPONSE');
      setProfiles(result.teachers);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    const stopPainting = () => { paintMode.current = null; };
    window.addEventListener('pointerup', stopPainting);
    window.addEventListener('pointercancel', stopPainting);
    return () => {
      window.removeEventListener('pointerup', stopPainting);
      window.removeEventListener('pointercancel', stopPainting);
    };
  }, []);

  const subjectList = useMemo(
    () => profile.subjects.split(',').map((subject) => subject.trim()).filter(Boolean),
    [profile.subjects],
  );

  const selectProfile = (saved) => {
    setProfile({
      id: saved.id,
      name: saved.name,
      phone: saved.phone || '',
      subjects: saved.subjects.join(', '),
      availability: Object.fromEntries(
        DAYS.map((day) => [day, Array.isArray(saved.availability[day]) ? saved.availability[day] : []]),
      ),
    });
    setMessage(null);
    setAssignmentResult(null);
  };

  const setPeriodAvailability = (day, period, available) => {
    setProfile((current) => {
      const periods = current.availability[day] || [];
      if (periods.includes(period) === available) return current;
      return {
        ...current,
        availability: {
          ...current.availability,
          [day]: available
            ? [...periods, period].sort((a, b) => PERIODS.indexOf(a) - PERIODS.indexOf(b))
            : periods.filter((value) => value !== period),
        },
      };
    });
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiCall('tempTeachers.save', {
        ...profile,
        subjects: subjectList,
      });
      if (!result?.teacher?.id) throw new ApiError('BAD_RESPONSE');
      setMessage(`${result.teacher.name}’s availability has been saved for reuse.`);
      setProfile((current) => ({ ...current, id: result.teacher.id }));
      await loadProfiles();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

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
          Save a teacher’s subjects and weekly availability once. The solver can reuse this
          preference when assigning sessions that could not fit the regular timetable.
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

      {weekNo && (
        <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-lg font-semibold text-ink">Resolve Week {weekNo} lags</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Assign compatible unfilled sessions into saved availability. A class or temporary
            teacher cannot be double-booked in the same slot.
          </p>
          <button
            type="button"
            onClick={assignLags}
            disabled={assigning || loading || profiles.length === 0}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {assigning && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {assigning ? 'Assigning sessions…' : 'Assign available temporary teachers'}
          </button>
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

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_2fr]">
        <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">Saved profiles</h2>
            <button
              type="button"
              onClick={() => { setProfile(emptyProfile()); setMessage(null); setAssignmentResult(null); }}
              className="rounded-md border border-ink/20 px-3 py-1.5 text-sm text-ink hover:bg-paper"
            >
              Add new
            </button>
          </div>
          {loading ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading saved profiles…
            </p>
          ) : profiles.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">No temporary teacher profiles saved yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {profiles.map((saved) => (
                <li key={saved.id}>
                  <button
                    type="button"
                    onClick={() => selectProfile(saved)}
                    className={`w-full rounded-md border px-3 py-2 text-start text-sm ${
                      profile.id === saved.id ? 'border-raihan-500 bg-raihan-100 text-raihan-700' : 'border-ink/15 hover:bg-paper'
                    }`}
                  >
                    <span className="block font-medium">{saved.name}</span>
                    <span className="block text-xs text-ink-soft">{saved.subjects.join(', ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={saveProfile} className="space-y-6 rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
          <div>
            <h2 className="text-lg font-semibold text-ink">{profile.id ? 'Edit availability' : 'Temporary teacher details'}</h2>
            <p className="mt-1 text-sm text-ink-soft">Saved preferences remain available for future weeks.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Teacher name
              <input
                required
                value={profile.name}
                onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))}
                className="mt-1.5 block w-full rounded-md border border-ink/20 px-3 py-2"
              />
            </label>
            <label className="text-sm font-medium text-ink">
              Phone (optional)
              <input
                type="tel"
                value={profile.phone}
                onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))}
                className="mt-1.5 block w-full rounded-md border border-ink/20 px-3 py-2"
              />
            </label>
            <label className="text-sm font-medium text-ink sm:col-span-2">
              Subjects (comma-separated)
              <input
                required
                value={profile.subjects}
                onChange={(event) => setProfile((current) => ({ ...current, subjects: event.target.value }))}
                placeholder="Quran Kareem, Fiqh"
                className="mt-1.5 block w-full rounded-md border border-ink/20 px-3 py-2"
              />
            </label>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-ink">Weekly availability · click free periods</legend>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-center text-xs">
                <thead>
                  <tr>
                    <th className="p-2 text-start font-medium text-ink-soft">Day</th>
                    {PERIODS.map((period) => <th key={period} className="p-2 font-medium text-ink-soft">{period}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((day) => (
                    <tr key={day} className="border-t border-ink/10">
                      <th className="whitespace-nowrap p-2 text-start font-medium text-ink">{day}</th>
                      {PERIODS.map((period) => {
                        const checked = (profile.availability[day] || []).includes(period);
                        return (
                          <td key={period} className="p-1">
                            <button
                              type="button"
                              aria-label={`${day} ${period} ${checked ? 'available' : 'unavailable'}`}
                              aria-pressed={checked}
                              onPointerDown={() => { paintMode.current = !checked; setPeriodAvailability(day, period, !checked); }}
                              onPointerEnter={() => {
                                if (paintMode.current !== null) setPeriodAvailability(day, period, paintMode.current);
                              }}
                              onPointerUp={() => { paintMode.current = null; }}
                              onClick={(event) => {
                                if (event.detail === 0) setPeriodAvailability(day, period, !checked);
                              }}
                              className={`h-8 w-8 touch-none select-none rounded-md border ${
                                checked ? 'border-raihan-600 bg-raihan-100 text-raihan-700' : 'border-ink/15 hover:bg-paper'
                              }`}
                            >
                              {checked ? '✓' : ''}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={saving || subjectList.length === 0 || !DAYS.some((day) => profile.availability[day]?.length)}
            className="inline-flex items-center gap-2 rounded-md bg-lapis-600 px-4 py-2 text-sm font-medium text-white hover:bg-lapis-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saving ? 'Saving preferences…' : 'Save teacher preferences'}
          </button>
        </form>
      </div>
    </section>
  );
}
