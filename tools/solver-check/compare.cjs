// Compares two Code.gs versions per grade under the v2 rules.
// usage: node tools/solver-check/compare.cjs OLD_Code.gs NEW_Code.gs JHS_Raw_Data.csv monsat|monfri [grade]
const fs = require('fs');
const { parseCsv, makeSpreadsheet, loadCode, weekOfCsv } = require('./gas.cjs');
const [oldCode, newCode, csvPath, mode, onlyGrade] = process.argv.slice(2);
const raw = parseCsv(fs.readFileSync(csvPath, 'utf8'));
const classes = [...new Set(raw.slice(1).map((r) => r[1]).filter(Boolean))];
const includeSaturday = mode !== 'monfri';
const wk = weekOfCsv(raw);
const endDate = includeSaturday ? wk.saturday : wk.friday;
const grades = [...new Set(classes.map((c) => c.split(' ')[0]))].sort((a, b) => a - b)
  .filter((g) => !onlyGrade || g === onlyGrade);

function sheetsFor(sel) {
  return makeSpreadsheet({
    JHS_Raw_Data: raw.map((r) => r.slice()),
    Raihan_Weeks: [['Week_No', 'Start_Date', 'End_Date', 'Classes_JSON', 'Status', 'Updated_At', 'Updated_By', 'Include_Saturday'],
      [1, wk.monday, endDate, JSON.stringify(sel), 'SETUP', '', '', includeSaturday]],
  });
}
const rows = [];
for (const g of grades) {
  const sel = classes.filter((c) => c.split(' ')[0] === g).sort();
  // v2
  const ssNew = sheetsFor(sel);
  const ctxN = loadCode(newCode, ssNew);
  const weekN = ctxN.getWeekRecord_(1);
  const a = ctxN.generateWeekSchedule_(weekN);
  // Evaluate the OLD placement with v2's model + rules.
  const ssOld = sheetsFor(sel);
  const ctxO = loadCode(oldCode, ssOld);
  ctxO.generateWeekSchedule_(ctxO.getWeekRecord_(1));
  const oldWork = ssOld.sheets.Raihan_Solver_Working.data.slice(1).filter((r) => r[1] === 'RAIHAN');
  const model = ctxN.buildWeekModel_(weekN);
  const dates = ctxN.raihanDates_(weekN);
  const dateIndex = {}; dates.forEach((d, i) => { dateIndex[d.date] = i; });
  const campus = {};
  model.sessions.forEach((s) => {
    if (s.status !== 'KEPT' || dateIndex[s.date] === undefined) return;
    s.assignments.forEach((x) => { (campus[x.id + '|' + s.date] = campus[x.id + '|' + s.date] || []).push(s.key + '#' + s.period); });
  });
  const oldDays = new Set(); const oldClash = new Set();
  oldWork.forEach((r) => {
    const t = String(r[7]); const d = String(r[9]); const p = ctxN.normalizePeriod_(r[10]);
    oldDays.add(t + '|' + d);
    (campus[t + '|' + d] || []).forEach((entry) => {
      const cp = entry.split('#')[1];
      if (ctxN.periodsClash_(p, cp)) oldClash.add(t + '|' + entry);
    });
  });
  const need = {};
  model.sessions.forEach((x) => { if (x.status === 'RAIHAN_PENDING' && x.primary) need[x.primary.id] = (need[x.primary.id] || 0) + 1; });
  const oldByT = {};
  oldWork.forEach((r) => { (oldByT[r[7]] = oldByT[r[7]] || new Set()).add(String(r[9])); });
  const oldExtra = Object.entries(oldByT).reduce((sum, [t, d]) => sum + Math.max(0, d.size - Math.ceil((need[t] || 1) / 9)), 0);
  const newExtra = a.teachers.reduce((sum, t) => sum + Math.max(0, t.raihanDays.length - Math.ceil(t.raihanSessions / 9)), 0);
  const demand = Object.values(a.demandByClass).reduce((x, y) => x + y, 0);
  const actions = {};
  a.campusSwapSuggestions.forEach((s) => { actions[s.action] = (actions[s.action] || 0) + 1; });
  rows.push({
    grade: g, classes: sel.length, lessonsToPlace: demand,
    old_unplaced: demand - oldWork.length, new_unplaced: a.lagCount,
    old_teacherDays: oldDays.size, new_teacherDays: a.teacherDayCount, old_extraDays: oldExtra, new_extraDays: newExtra,
    teachers: a.teachers.length, substitutesNeeded: a.campusSwapSuggestions.filter((x) => x.action === 'NEEDS_SUBSTITUTE').length,
    old_clashes: oldClash.size, new_clashes: a.localCampusCollisionCount,
    swaps: actions, capacity: a.capacityPerClass, deptStaffed: a.departmentStaffed,
    notHeld: a.notHeldCount, ms: a.solver.elapsedMs, iters: a.solver.iterations,
  });
  console.error(JSON.stringify(rows[rows.length - 1]));
}
console.table(rows.map((r) => ({ grade: r.grade, lessons: r.lessonsToPlace, unplaced: r.old_unplaced + ' -> ' + r.new_unplaced, extraDays: r.old_extraDays + ' -> ' + r.new_extraDays, clashes: r.old_clashes + ' -> ' + r.new_clashes })));
