import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { ApiError, UNKNOWN_ERROR_MESSAGE, apiCall } from '@/services/api';
import { getActiveAllocationWeek } from '@/modules/allocation/allocationSession';

const WEEK_NUMBERS = Array.from({ length: 41 }, (_, index) => index + 1);
const PERIODS = Array.from({ length: 9 }, (_, index) => `Period ${index + 1}`);
const CAMPUS_PERIODS = Array.from({ length: 10 }, (_, index) => `Period ${index + 1}`);

function displayDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function subjectKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[ʿʻ']/g, '').replace(/[^a-z0-9]/g, '');
}

export default function OutputsPage() {
  const [searchParams] = useSearchParams();
  const [weekNo, setWeekNo] = useState(
    () => Number(searchParams.get('week')) || getActiveAllocationWeek(),
  );
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewBy, setViewBy] = useState('subject');
  const [filter, setFilter] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [campusClassFilter, setCampusClassFilter] = useState('all');
  const [dragged, setDragged] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [teacherId, setTeacherId] = useState('');
  const [subject, setSubject] = useState('');
  const [campusTargets, setCampusTargets] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadWeek = async (targetWeek = weekNo) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall('allocation.getFinalWeek', { weekNo: targetWeek });
      if (!Array.isArray(result?.sessions) || !Array.isArray(result?.pending) ||
          !Array.isArray(result?.teachers) || !Array.isArray(result?.occupied) ||
          !Array.isArray(result?.dates) || !Array.isArray(result?.campusSessions) ||
          !Array.isArray(result?.classes) || !Array.isArray(result?.raihanSubjects)) {
        throw new ApiError('BAD_RESPONSE');
      }
      setData(result);
      setSelectedClass((current) => result.classes.includes(current) ? current : result.classes[0] || '');
      setDropTarget(null);
      setDragged(null);
      setCampusTargets({});
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

  const filterValues = useMemo(() => {
    if (!data) return [];
    return [...new Set([...data.sessions, ...data.campusSessions].map((session) =>
      viewBy === 'teacher' ? session.teacherName : session.subject,
    ).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [data, viewBy]);

  const selectedClassSessions = useMemo(() => (
    data?.sessions.filter((session) => session.className === selectedClass) ?? []
  ), [data, selectedClass]);
  const weekdayCount = data?.dates.filter(({ day }) =>
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(day),
  ).length || 0;

  const cellSession = (date, period) =>
    selectedClassSessions.find((session) => session.date === date && session.period === period);
  const matchesGridFilter = (session) => !filter ||
    (viewBy === 'teacher' ? session.teacherName : session.subject) === filter;

  const eligibleTeachers = (target, selectedSubject, movingSession) => {
    if (!data || !target) return [];
    const moving = movingSession || dragged || [...data.sessions, ...data.pending]
      .find((item) => item.rowNumber === dropTarget?.rowNumber);
    return data.teachers.filter((teacher) => {
      const teaches = (teacher.subjects || []).some((value) => value === '*' ||
        subjectKey(value) === subjectKey(selectedSubject));
      if (!teaches) return false;
      if (teacher.temporary) {
        const day = target.day;
        const periods = teacher.availability?.[day] || [];
        return periods.some((value) => `Period ${String(value).replace(/^P/i, '').replace(/^Period\s*/i, '')}` === target.period) &&
          (teacher.availableDays || []).some((item) => item.date === target.date);
      }
      return (teacher.dates || [teacher.date]).includes(target.date);
    }).filter((teacher) => !(data.occupied || []).some((slot) =>
      slot.date === target.date &&
      slot.period === `P${target.period.replace('Period ', '')}` &&
      slot.teacherIds.includes(teacher.teacherId) &&
      !(moving && moving.status !== 'LAG' &&
        slot.date === moving.date &&
        slot.period === `P${String(moving.period).replace(/^P/i, '').replace(/^Period\s*/i, '')}` &&
        slot.className === moving.className &&
        slot.teacherIds.includes(moving.teacherId)),
    ));
  };

  const openPlacement = (item, target) => {
    if (!item || !target) return;
    const occupiedSession = cellSession(target.date, target.period);
    if (occupiedSession && occupiedSession.rowNumber !== item.rowNumber) {
      setError(`${target.day} ${target.period} is occupied by ${occupiedSession.subject} (${occupiedSession.teacherName}). Move that card to a free cell first; if the issue is teacher availability, choose a compatible temporary teacher or change the subject.`);
      return;
    }
    const next = { ...target, rowNumber: item.rowNumber };
    const preferredSubject = item.subject || '';
    const validSubject = data.raihanSubjects.includes(preferredSubject) ? preferredSubject : data.raihanSubjects[0];
    setDragged(item);
    setDropTarget(next);
    setSubject(validSubject);
    const candidates = eligibleTeachers(next, validSubject, item);
    setTeacherId(candidates[0]?.teacherId || '');
    setError(candidates.length ? null : 'No available teacher fits this subject and slot. Change the subject or choose a different day/period; temporary teachers are included when their saved availability matches.');
  };

  const beginDrop = (event, target) => {
    event.preventDefault();
    if (dragged) openPlacement(dragged, target);
  };

  const updatePlacementTarget = (date, period) => {
    const day = data.dates.find((entry) => entry.date === date)?.day || '';
    const next = { ...dropTarget, date, day, period };
    setDropTarget(next);
    const occupiedSession = cellSession(date, period);
    if (occupiedSession && occupiedSession.rowNumber !== next.rowNumber) {
      setTeacherId('');
      setError(`${day} ${period} is occupied by ${occupiedSession.subject} (${occupiedSession.teacherName}). Choose a free slot.`);
      return;
    }
    const candidates = eligibleTeachers(next, subject);
    setTeacherId((current) => candidates.some((teacher) => teacher.teacherId === current)
      ? current
      : candidates[0]?.teacherId || '');
    setError(candidates.length ? null : 'No available teacher fits this subject and slot. Change the subject, slot or teacher; matching temporary-teacher availability is included.');
  };

  const firstOpenTarget = () => {
    for (const { date, day } of data.dates) {
      for (const period of PERIODS) {
        if (!cellSession(date, period)) return { date, day, period, className: selectedClass };
      }
    }
    const firstDate = data.dates[0];
    return firstDate ? { ...firstDate, period: PERIODS[0], className: selectedClass } : null;
  };

  const openPendingPlacement = (pending) => {
    const target = firstOpenTarget();
    if (target) openPlacement(pending, target);
    else setError('No weekdays are available in this week’s saved relocation date range. Update the dates in Allocation and rebuild the schedule.');
  };
  const placementCellSession = dropTarget && cellSession(dropTarget.date, dropTarget.period);
  const placementSlotOccupied = placementCellSession &&
    placementCellSession.rowNumber !== dropTarget.rowNumber;

  const saveDrop = async () => {
    if (!dropTarget || !teacherId || !subject) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiCall('allocation.assignLag', {
        weekNo,
        rowNumber: dropTarget.rowNumber,
        teacherId,
        subject,
        targetDate: dropTarget.date,
        period: dropTarget.period,
      });
      if (!Array.isArray(result?.sessions) || !Array.isArray(result?.pending)) {
        throw new ApiError('BAD_RESPONSE');
      }
      setNotice(`Saved ${selectedClass} · ${subject} for ${dropTarget.day}, ${dropTarget.period}.`);
      setDropTarget(null);
      await loadWeek(weekNo);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  const resolveCampusClash = async (session) => {
    const target = campusTargets[session.rowNumber] || {
      date: session.date,
      period: session.period,
    };
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiCall('allocation.resolveCampusClash', {
        weekNo,
        rowNumber: session.rowNumber,
        targetDate: target.date,
        period: target.period,
      });
      setNotice(`Moved ${session.className} · ${session.subject} to ${displayDate(target.date)} ${target.period}.`);
      await loadWeek(weekNo);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : UNKNOWN_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  const filteredCampusSessions = useMemo(() => (
    (data?.campusSessions || []).filter((session) =>
      (campusClassFilter === 'all' || session.className === campusClassFilter) &&
      (!filter || (viewBy === 'teacher' ? session.teacherName : session.subject) === filter),
    )
  ), [campusClassFilter, data, filter, viewBy]);

  return (
    <section className="mx-auto max-w-7xl space-y-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-raihan-700">Allocation puzzle</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">Raihan final timetable</h1>
        <p className="mt-3 max-w-4xl text-ink-soft">
          View all weekdays for one class. Click Edit / move on a placed card or choose a pending card’s slot, then select the date, period, subject and an eligible teacher. Drag-and-drop is also available. Only the ten Raihan subjects are placed; other lessons remain visible in the Jamea campus clash report.
        </p>
        {data && (
          <p className="mt-2 text-sm text-ink-soft">
            Showing {data.dates.length} date(s) in the saved window, {displayDate(data.startDate)}–{displayDate(data.endDate)}.
            {' '}Use <Link to="/allocation" className="font-medium text-raihan-700 underline">Allocation</Link> to adjust the date range and rebuild if weekdays are missing.
          </p>
        )}
        {data && weekdayCount < 5 && (
          <p role="alert" className="mt-2 rounded-md border border-saffron-500/40 bg-saffron-100 p-3 text-sm text-saffron-800">
            Only {weekdayCount} Monday–Friday date(s) are included in this week’s saved range. Set the full Monday–Friday date range in Allocation and rebuild to show the complete timetable.
          </p>
        )}
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
            <select value={weekNo} onChange={(event) => setWeekNo(Number(event.target.value))}
              disabled={loading || saving} className="mt-1.5 block min-w-36 rounded-md border border-ink/20 bg-white px-3 py-2">
              {WEEK_NUMBERS.map((number) => <option key={number} value={number}>Week {number}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            Class
            <select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}
              disabled={!data} className="mt-1.5 block min-w-40 rounded-md border border-ink/20 bg-white px-3 py-2">
              {(data?.classes || []).map((className) => <option key={className} value={className}>{className}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            Show/filter by
            <select value={viewBy} onChange={(event) => { setViewBy(event.target.value); setFilter(''); }}
              className="mt-1.5 block min-w-36 rounded-md border border-ink/20 bg-white px-3 py-2">
              <option value="subject">Subject</option><option value="teacher">Teacher</option>
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            {viewBy === 'teacher' ? 'Teacher' : 'Subject'}
            <select value={filter} onChange={(event) => setFilter(event.target.value)}
              className="mt-1.5 block min-w-44 rounded-md border border-ink/20 bg-white px-3 py-2">
              <option value="">All</option>
              {filterValues.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => loadWeek()} disabled={loading || saving}
            className="inline-flex items-center gap-2 rounded-md border border-ink/20 px-3 py-2 text-sm hover:bg-paper disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
        </div>

        {loading ? (
          <p role="status" className="mt-6 flex items-center gap-2 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading five-day timetable…
          </p>
        ) : !data ? (
          <p className="mt-6 rounded-md bg-paper p-4 text-sm text-ink-soft">Build the schedule for this week in Allocation first.</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg border border-ink/10">
            <table className="min-w-[760px] w-full table-fixed border-collapse text-sm xl:min-w-0">
              <thead className="bg-paper">
                <tr>
                  <th className="sticky left-0 z-10 min-w-28 border-b border-ink/10 bg-paper p-3 text-start">Period</th>
                  {data.dates.map(({ date, day }) => (
                    <th key={date} className="border-b border-ink/10 p-2 text-center sm:p-3">
                      <span className="block">{day}</span><span className="text-xs font-normal text-ink-soft">{displayDate(date)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERIODS.map((period) => (
                  <tr key={period} className="border-b border-ink/10 last:border-0">
                    <th scope="row" className="sticky left-0 z-10 bg-white p-3 text-start font-medium">{period}</th>
                    {data.dates.map(({ date, day }) => {
                      const session = cellSession(date, period);
                      const target = { date, day, period, className: selectedClass };
                      const targetIsEditing = dropTarget?.date === date && dropTarget?.period === period;
                      return (
                        <td key={date} onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => beginDrop(event, target)}
                          className={`border-s border-ink/5 p-2 align-top ${!session ? 'bg-raihan-50/40' : ''}`}>
                          {session ? (
                            <div draggable={matchesGridFilter(session)} onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', String(session.rowNumber));
                              event.dataTransfer.effectAllowed = 'move';
                              setDragged(session);
                            }}
                              onDragEnd={() => setDragged(null)}
                              className={`rounded-md border p-1.5 sm:p-2 ${
                                matchesGridFilter(session)
                                  ? 'cursor-grab border-raihan-500/30 bg-raihan-100 active:cursor-grabbing'
                                  : 'border-ink/10 bg-paper opacity-60'
                              }`}>
                              {matchesGridFilter(session) ? (
                                <>
                                  <span className="block font-medium text-raihan-800">
                                    {viewBy === 'teacher' ? session.teacherName : session.subject}
                                  </span>
                                  <span className="block text-xs text-ink-soft">
                                    {viewBy === 'teacher' ? session.subject : session.teacherName}
                                  </span>
                                  <button type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openPlacement(session, {
                                        date: session.date,
                                        day: session.day,
                                        period: session.period,
                                        className: session.className,
                                      });
                                    }}
                                    className="mt-2 rounded border border-raihan-700/30 bg-white px-2 py-1 text-xs font-medium text-raihan-800 hover:bg-raihan-50">
                                    Edit / move
                                  </button>
                                </>
                              ) : <span className="text-xs text-ink-soft">Occupied · filtered out</span>}
                            </div>
                          ) : (
                            <div aria-label={`Drop allocation in ${day} ${period}`}
                              className={`grid min-h-14 place-items-center rounded-md border border-dashed text-xs ${
                                targetIsEditing ? 'border-raihan-600 bg-raihan-100 text-raihan-800' : 'border-ink/15 text-ink/35'
                              }`}>
                              {targetIsEditing ? 'Drop here' : 'Drop card here'}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dropTarget && data && (
          <section aria-label="Confirm timetable placement" className="mt-5 rounded-lg border border-raihan-500/30 bg-raihan-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-ink">Place {dragged?.subject || 'session'} in {dropTarget.day} · {dropTarget.period}</h2>
                <p className="text-sm text-ink-soft">{selectedClass} · {displayDate(dropTarget.date)}</p>
              </div>
              <button type="button" onClick={() => setDropTarget(null)} aria-label="Cancel placement" className="rounded p-1 hover:bg-white">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
              <label className="text-sm font-medium text-ink">
                Day / date
                <select value={dropTarget.date} onChange={(event) => updatePlacementTarget(event.target.value, dropTarget.period)}
                  className="mt-1 block w-full rounded-md border border-ink/20 bg-white px-3 py-2">
                  {data.dates.map(({ date, day }) => (
                    <option key={date} value={date}>{day} · {displayDate(date)}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-ink">
                Period
                <select value={dropTarget.period} onChange={(event) => updatePlacementTarget(dropTarget.date, event.target.value)}
                  className="mt-1 block w-full rounded-md border border-ink/20 bg-white px-3 py-2">
                  {PERIODS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-ink">
                Subject (change if needed)
                <select value={subject} onChange={(event) => {
                  setSubject(event.target.value);
                  const choices = eligibleTeachers(dropTarget, event.target.value);
                  setTeacherId(choices[0]?.teacherId || '');
                  if (!choices.length) setError('No teacher is free in this slot for that subject. Choose another subject or slot, or add a compatible temporary teacher.');
                  else setError(null);
                }} className="mt-1 block w-full rounded-md border border-ink/20 bg-white px-3 py-2">
                  {data.raihanSubjects.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-ink">
                Teacher (temporary teachers included)
                <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}
                  className="mt-1 block w-full rounded-md border border-ink/20 bg-white px-3 py-2">
                  <option value="">Choose a teacher</option>
                  {eligibleTeachers(dropTarget, subject).map((teacher) => (
                    <option key={teacher.teacherId} value={teacher.teacherId}>
                      {teacher.teacherName}{teacher.temporary ? ' · Temporary' : ` · ${(teacher.days || [teacher.day]).join(' / ')}`}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={saveDrop}
                disabled={saving || !teacherId || !subject || placementSlotOccupied}
                className="rounded-md bg-raihan-700 px-4 py-2 text-sm font-medium text-white hover:bg-raihan-500 disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? 'Saving…' : 'Save placement'}
              </button>
            </div>
          </section>
        )}

        {data?.pending?.length > 0 && (
          <section className="mt-8 rounded-lg border border-saffron-500/30 bg-saffron-100 p-4">
            <h2 className="font-semibold text-saffron-800">Pending Raihan subjects · choose a slot or drag a card into the grid</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.pending.filter((item) => item.className === selectedClass).map((pending) => (
                <div key={pending.rowNumber} draggable onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', String(pending.rowNumber));
                  event.dataTransfer.effectAllowed = 'move';
                  setDragged(pending);
                }}
                  onDragEnd={() => setDragged(null)}
                  className="cursor-grab rounded-md border border-saffron-500/30 bg-white px-3 py-2 text-sm active:cursor-grabbing">
                  <span className="block font-medium">{pending.subject}</span>
                  <span className="block text-xs text-ink-soft">{pending.diagnostic}</span>
                  <button type="button" onClick={() => openPendingPlacement(pending)}
                    className="mt-2 rounded border border-saffron-500/40 px-2 py-1 text-xs font-medium text-saffron-800 hover:bg-saffron-50">
                    Choose slot
                  </button>
                </div>
              ))}
              {!data.pending.some((item) => item.className === selectedClass) && (
                <p className="text-sm text-ink-soft">No pending sessions for this class.</p>
              )}
            </div>
          </section>
        )}
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="text-xl font-semibold text-ink">Jamea campus schedule and clashes</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Red rows are unresolved campus collisions. Choose another date and period to move the
          campus session; class and teacher clashes are checked before the move is saved.
        </p>
        <label className="mt-4 block max-w-xs text-sm font-medium text-ink">
          Campus class
          <select value={campusClassFilter} onChange={(event) => setCampusClassFilter(event.target.value)}
            className="mt-1 block w-full rounded-md border border-ink/20 bg-white px-3 py-2">
            <option value="all">All classes</option>
            {[...new Set((data?.campusSessions || []).map((session) => session.className))].sort()
              .map((className) => <option key={className} value={className}>{className}</option>)}
          </select>
        </label>
        {!filteredCampusSessions.length ? (
          <p className="mt-4 text-sm text-ink-soft">No campus sessions or clashes for this class and filter.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-ink/10">
            <table className="min-w-[850px] w-full border-collapse text-sm">
              <thead className="bg-paper">
                <tr>
                  {['Day / date','Period','Class','Subject','Teacher','Status'].map((heading) =>
                    <th key={heading} className="border-b border-ink/10 p-3 text-start">{heading}</th>)}
                  <th className="border-b border-ink/10 p-3 text-start">Resolve clash</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampusSessions.map((session, index) => (
                  <tr key={`${session.date}-${session.period}-${session.className}-${session.subject}-${index}`}
                    className={session.hasCollision ? 'bg-saffron-100 text-saffron-800' : 'border-b border-ink/5'}>
                    <td className="p-3">{session.day} · {displayDate(session.date)}</td>
                    <td className="p-3">{session.period}</td>
                    <td className="p-3">{session.className}</td>
                    <td className="p-3">{session.subject}</td>
                    <td className="p-3">{session.teacherName || session.teacherId || '—'}</td>
                    <td className="p-3">{session.hasCollision ? 'Collision needs resolution' : session.status === 'MOVED' ? 'Moved from source slot' : 'Campus'}</td>
                    <td className="p-3">
                      {session.hasCollision ? (
                        <div className="flex min-w-72 flex-wrap items-center gap-2">
                          <select
                            aria-label={`New day for ${session.className} ${session.subject}`}
                            value={(campusTargets[session.rowNumber]?.date) || session.date}
                            onChange={(event) => setCampusTargets((current) => ({
                              ...current,
                              [session.rowNumber]: {
                                ...current[session.rowNumber],
                                date: event.target.value,
                                period: current[session.rowNumber]?.period || session.period,
                              },
                            }))}
                            className="rounded-md border border-ink/20 bg-white px-2 py-1"
                          >
                            {data.dates.map(({ date, day }) => <option key={date} value={date}>{day} {displayDate(date)}</option>)}
                          </select>
                          <select
                            aria-label={`New period for ${session.className} ${session.subject}`}
                            value={(campusTargets[session.rowNumber]?.period) || session.period}
                            onChange={(event) => setCampusTargets((current) => ({
                              ...current,
                              [session.rowNumber]: {
                                ...current[session.rowNumber],
                                date: current[session.rowNumber]?.date || session.date,
                                period: event.target.value,
                              },
                            }))}
                            className="rounded-md border border-ink/20 bg-white px-2 py-1"
                          >
                            {CAMPUS_PERIODS.map((period) => <option key={period} value={period}>{period}</option>)}
                          </select>
                          <button type="button" onClick={() => resolveCampusClash(session)}
                            disabled={saving || (
                              (campusTargets[session.rowNumber]?.date || session.date) === session.date &&
                              (campusTargets[session.rowNumber]?.period || session.period) === session.period
                            )}
                            className="rounded-md bg-lapis-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                            Move campus session
                          </button>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
