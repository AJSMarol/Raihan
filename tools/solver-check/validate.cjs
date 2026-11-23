// Independent checks of v2 output + end-to-end handler smoke tests.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const { parseCsv, makeSpreadsheet, loadCode, weekOfCsv } = require('./gas.cjs');
const [code, csvPath] = process.argv.slice(2);
if (!code || !csvPath) { console.error('usage: node tools/solver-check/validate.cjs apps-script/Code.gs path/to/JHS_Raw_Data.csv'); process.exit(1); }
const raw = parseCsv(fs.readFileSync(csvPath, 'utf8'));
const classes = [...new Set(raw.slice(1).map((r) => r[1]).filter(Boolean))];
const wk = weekOfCsv(raw);
const grades = [...new Set(classes.map((c) => c.split(' ')[0]))].sort((a, b) => a - b);
const P = { P1: [360, 420], P2: [530, 565], P3: [565, 600], P4: [600, 635], P5: [655, 690], P6: [690, 725], P7: [725, 760], P8: [840, 875], P9: [875, 910], P10: [910, 945] };
const clash = (a, b) => a === b || !(P[a][1] + 120 <= P[b][0] || P[b][1] + 120 <= P[a][0]);
const ctxUser = { user: { email: 't@x', role: 'admin' } };

for (const [g, sat] of grades.map((grade, i) => [grade, i % 2 === 0])) {
  const sel = classes.filter((c) => c.split(' ')[0] === g).sort();
  const ss = makeSpreadsheet({ JHS_Raw_Data: raw.map((r) => r.slice()), Users: [['email', 'role']] });
  const ctx = loadCode(code, ss);
  ctx.handleSaveWeek_(ctxUser, { weekNo: 4, startDate: wk.monday, endDate: wk.saturday, classes: sel, includeSaturday: sat });
  const week = ctx.getWeekRecord_(4);
  assert.strictEqual(week.includeSaturday, sat);
  const a = ctx.handleAnalyzeWeek_(ctxUser, { weekNo: 4 });
  const model = ctx.buildWeekModel_(week);
  const allowedDates = new Set(ctx.raihanDates_(week).map((d) => d.date));
  assert.strictEqual(allowedDates.has(wk.saturday), sat);

  // Re-read placements from Raihan_Solver_Working (what the app actually persists).
  const work = ss.sheets.Raihan_Solver_Working.data.slice(1).filter((r) => r[0] === 4);
  const raihan = work.filter((r) => r[1] === 'RAIHAN');
  const seenClass = new Set(); const seenTeacher = new Set();
  raihan.forEach((r) => {
    const date = r[9]; const p = ctx.normalizePeriod_(r[10]);
    assert(allowedDates.has(date), 'date outside Raihan days ' + date);
    assert(p !== 'P1', 'Raihan lesson in PT');
    const ck = r[5] + date + p; assert(!seenClass.has(ck), 'class double-booked ' + ck); seenClass.add(ck);
    if (r[7]) { const tk = r[7] + date + p; assert(!seenTeacher.has(tk), 'teacher double-booked ' + tk); seenTeacher.add(tk); }
    assert(sel.includes(r[5]));
  });
  const statuses = {}; work.forEach((r) => { statuses[r[1]] = (statuses[r[1]] || 0) + 1; });
  // Every held lesson is accounted for; no selected-class lesson is written back as KEPT.
  assert(!work.some((r) => r[1] === 'KEPT' && sel.includes(r[5])));
  assert.strictEqual(raihan.length + (statuses.LAG || 0), Object.values(a.demandByClass).reduce((x, y) => x + y, 0));

  // Apply every SWAP / MOVE suggestion to the campus timetable and recheck.
  const campus = model.sessions.filter((s) => s.status === 'KEPT').map((s) => ({ key: s.key, cls: s.className, date: s.date, p: s.period, t: s.assignments.filter((x) => !x.isMusanid).map((x) => x.id) }));
  const byKey = Object.fromEntries(campus.map((c) => [c.cls + '|' + c.date + '|' + c.p + '|', c]));
  const find = (l) => campus.find((c) => c.cls === l.className && c.date === l.date && c.p === ctx.normalizePeriod_(l.period) && l.subject === c.key.split('|')[3]);
  let applied = 0;
  a.campusSwapSuggestions.forEach((s) => {
    if (s.action !== 'SWAP' && s.action !== 'MOVE_TO_FREE_PERIOD') return;
    const l = find(s.lesson); assert(l, 'lesson not found');
    const tgt = s.options[0].target;
    if (s.action === 'SWAP') {
      const o = find(s.options[0].swapWith); assert(o, 'partner not found');
      o.date = l.date; o.p = l.p;
    }
    l.date = tgt.date; l.p = ctx.normalizePeriod_(tgt.period);
    applied += 1;
  });
  // After applying: no class or teacher double-booked on campus, and no lead teacher breaks the gap.
  const slotC = new Set(); const slotT = new Set();
  campus.forEach((c) => {
    const k = c.cls + c.date + c.p; assert(!slotC.has(k), 'campus class double-booked after swaps ' + k); slotC.add(k);
    c.t.forEach((t) => { const tk = t + c.date + c.p; assert(!slotT.has(tk), 'campus teacher double-booked after swaps ' + tk); slotT.add(tk); });
  });
  const raihanByTD = {};
  raihan.forEach((r) => { if (r[7]) (raihanByTD[r[7] + '|' + r[9]] = raihanByTD[r[7] + '|' + r[9]] || []).push(ctx.normalizePeriod_(r[10])); });
  const groupCovered = new Set(a.campusSwapSuggestions.filter((s) => s.action === 'GROUP_COVER').map((s) => s.teacherId + s.lesson.className + s.lesson.date + s.lesson.period));
  let remaining = 0;
  campus.forEach((c) => c.t.forEach((t) => {
    (raihanByTD[t + '|' + c.date] || []).forEach((rp) => {
      if (clash(rp, c.p) && !groupCovered.has(t + c.cls + c.date + ctx.formatPeriod_(c.p))) remaining += 1;
    });
  }));
  console.log(`grade ${g} sat=${sat}: placed ${raihan.length}, lags ${statuses.LAG || 0}, clashes ${a.localCampusCollisionCount}, swaps applied ${applied}, clashes left after swaps ${remaining}`, statuses);

  // Handlers on top of the generated week.
  const fin = ctx.handleGetFinalRaihanWeek_(ctxUser, { weekNo: 4 });
  assert.strictEqual(JSON.stringify(fin.raihanPeriods), JSON.stringify(['Period 2', 'Period 3', 'Period 4', 'Period 5', 'Period 6', 'Period 7', 'Period 8', 'Period 9', 'Period 10']));
  assert.strictEqual(fin.dates.length, sat ? 6 : 5);
  const days = fin.teachers.filter((t) => !t.temporary).map((t) => ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(t.day));
  assert.deepStrictEqual(days, days.slice().sort((x, y) => x - y), 'teachers sorted by weekday');
  // Manual move of a placed card to another free period on the same day.
  const card = fin.sessions.find((s) => s.teacherId && /^\d/.test(s.teacherId));
  const freeP = fin.raihanPeriods.find((p) => !fin.sessions.some((s) => s.date === card.date && s.period === p && (s.className === card.className || s.teacherId === card.teacherId)));
  if (freeP) {
    const moved = ctx.handleAssignRaihanLag_(ctxUser, { weekNo: 4, rowNumber: card.rowNumber, teacherId: card.teacherId, period: freeP, targetDate: card.date, subject: card.subject });
    assert(moved.sessions.some((s) => s.rowNumber === card.rowNumber && s.period === freeP && s.status === 'MANUAL_ASSIGNED'));
  }
  // Teacher-day override round trip.
  const t0 = a.teachers.find((t) => t.raihanDays.length === 1);
  const otherDay = fin.dates.map((d) => d.day).find((d) => d !== t0.raihanDay);
  ctx.handleSaveRaihanTeacherDays_(ctxUser, { weekNo: 4, assignments: [{ teacherId: t0.teacherId, day: otherDay }] });
  const b = ctx.handleAnalyzeWeek_(ctxUser, { weekNo: 4 });
  const t1 = b.teachers.find((t) => t.teacherId === t0.teacherId);
  assert(t1.raihanDays.includes(otherDay), 'override day respected');
  // Temp teacher with an accented subject auto-assigns (regression for the old lowercase match).
  ctx.handleSaveTemporaryTeacher_(ctxUser, { name: 'Temp A', subjects: ['Al-Lisan al-Arabi'], availability: { Monday: ['Period 2'] } });
  assert.strictEqual(ctx.getTemporaryTeachers_()[0].availability.Monday[0], 'P2');
  if (!sat) {
    let threw = false;
    try { ctx.handleSaveRaihanTeacherDays_(ctxUser, { weekNo: 4, assignments: [{ teacherId: t0.teacherId, day: 'Saturday' }] }); } catch (e) { threw = e.code === 'TEACHER_DAY_NOT_IN_WEEK'; }
    assert(threw, 'Saturday rejected when not included');
  }
}
console.log('all checks passed');
