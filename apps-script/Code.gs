/**
 * Raihan Timetable AI - Apps Script API (auth + role lookup)
 *
 * Setup: open the Google Sheet > Extensions > Apps Script and paste this file. Keep
 * GOOGLE_CLIENT_ID matched with src/config/publicConfig.js, then Deploy > New deployment > Web app:
 *   Execute as: Me        Who has access: Anyone
 * ("Anyone", not "Anyone with a Google account" - the browser can't send Google cookies here.
 *  Access is controlled by the ID-token check and the Users sheet below.)
 *
 * After editing this file, use Deploy > Manage deployments > Edit > New version
 * so the /exec URL stays the same.
 *
 * Users sheet (tab name "Users", header row required):
 *   email | role | name | assigned_class | teacher_id | active
 *   role is one of: admin, scheduler, monitor, viewer
 *   assigned_class is required for monitors (e.g. "4 A M")
 *   active: leave blank or TRUE to allow, FALSE to block
 */

const CONFIG = {
  GOOGLE_CLIENT_ID: '876000319872-6tlbemn0hvv2g78ag3b97hqth863n6cg.apps.googleusercontent.com',
  USERS_SHEET: 'Users',
  VALID_ROLES: ['admin', 'scheduler', 'monitor', 'viewer'],
};

/**
 * Every action the frontend can call. The backend checks the role itself, so hiding a page in
 * the UI is never the only protection. Later modules register here, e.g.
 *   'allocation.run': { roles: ['admin', 'scheduler'], handler: runAllocation_ },
 */
const ROUTES_ = {
  'auth.login': { roles: ['admin', 'scheduler', 'monitor', 'viewer'], handler: handleLogin_ },
  'relocation.getWeek': {
    roles: ['admin', 'scheduler'],
    handler: handleGetWeek_,
  },
  'relocation.saveWeek': {
    roles: ['admin', 'scheduler'],
    handler: handleSaveWeek_,
  },
  'relocation.analyzeWeek': {
    roles: ['admin', 'scheduler'],
    handler: handleAnalyzeWeek_,
  },
  'relocation.recordAction': {
    roles: ['admin', 'scheduler'],
    handler: handleRecordWeekAction_,
  },
  'relocation.assignTemporary': {
    roles: ['admin', 'scheduler'],
    handler: handleAssignTemporary_,
  },
  'relocation.saveTeacherDays': {
    roles: ['admin', 'scheduler'],
    handler: handleSaveRaihanTeacherDays_,
  },
  'allocation.getFinalWeek': {
    roles: ['admin', 'scheduler'],
    handler: handleGetFinalRaihanWeek_,
  },
  'allocation.assignLag': {
    roles: ['admin', 'scheduler'],
    handler: handleAssignRaihanLag_,
  },
  'allocation.resolveCampusClash': {
    roles: ['admin', 'scheduler'],
    handler: handleResolveCampusClash_,
  },
  'tempTeachers.list': {
    roles: ['admin', 'scheduler'],
    handler: handleListTemporaryTeachers_,
  },
  'tempTeachers.save': {
    roles: ['admin', 'scheduler'],
    handler: handleSaveTemporaryTeacher_,
  },
};

const RAW_DATA_SHEET_ = 'JHS_Raw_Data';
const RAIHAN_WEEKS_SHEET_ = 'Raihan_Weeks';
const RAIHAN_WEEK_LOGS_SHEET_ = 'Raihan_Week_Logs';
const RAIHAN_TEMP_TEACHERS_SHEET_ = 'Raihan_Temp_Teachers';
const WEEKDAYS_ = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SOURCE_PERIODS_PER_DAY_ = 10;
// Raihan teaching periods. PT (Period 1, 6-7am) is Khaimat Riyadat, held outside the timetable.
const RAIHAN_PERIODS_ = ['P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'];
const RAIHAN_SUBJECTS_ = [
  'Adab', 'Akhbaar', 'Al-Lisān al-ʿArabī', 'English', 'Fiqh', 'Hikmat',
  'Quran Kareem', 'Sciences', 'Takhassus', 'Tamreen', 'Tawil',
];

function doGet() {
  return json_({ ok: true, data: { service: 'raihan-timetable-ai', version: 1 } });
}

function isoToSheetDate_(isoDate) {
  return Utilities.parseDate(
    isoDate,
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(),
    'yyyy-MM-dd'
  );
}

function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    const route = ROUTES_[request.action];
    if (!route) throw apiError_('UNKNOWN_ACTION');

    const identity = verifyIdToken_(request.idToken);
    const user = loadUser_(identity);
    if (route.roles.indexOf(user.role) === -1) throw apiError_('FORBIDDEN');

    return json_({ ok: true, data: route.handler({ identity: identity, user: user }, request.payload || {}) });
  } catch (err) {
    if (!err.code) console.error(err);
    return json_({ ok: false, error: err.code || 'SERVER_ERROR' });
  }
}

/* ---- handlers -------------------------------------------------------------------------- */

function handleLogin_(ctx) {
  return ctx.user;
}

function getRawClasses_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RAW_DATA_SHEET_);
  if (!sheet) throw apiError_('RAW_DATA_MISSING');

  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];

  const headers = values[0].map(function (value) {
    return String(value).trim().toLowerCase();
  });
  const classColumn = headers.indexOf('class');
  if (classColumn === -1) throw apiError_('RAW_DATA_MISCONFIGURED');

  const uniqueClasses = {};
  values.slice(1).forEach(function (row) {
    const className = String(row[classColumn] || '').trim();
    if (className) uniqueClasses[className] = true;
  });
  return Object.keys(uniqueClasses).sort();
}

function handleGetWeek_(ctx, payload) {
  const weekNo = validateWeekNo_(payload.weekNo);
  const week = getWeekRecord_(weekNo);
  return { week: week, classes: getRawClasses_() };
}

function handleSaveWeek_(ctx, payload) {
  const week = validateWeekPayload_(payload);
  const knownClasses = {};
  getRawClasses_().forEach(function (className) {
    knownClasses[className] = true;
  });
  week.classes.forEach(function (className) {
    if (!knownClasses[className]) throw apiError_('INVALID_CLASS');
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getWeekSheet_();
    const row = [
      week.weekNo,
      week.startDate,
      week.endDate,
      JSON.stringify(week.classes),
      'SETUP',
      new Date(),
      ctx.user.email,
      week.includeSaturday,
    ];
    const rowIndex = findWeekRow_(sheet, week.weekNo);
    if (rowIndex) sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);

    appendWeekLog_(week.weekNo, ctx.user.email, 'WEEK_CONFIG_SAVED', week);
    return { week: getWeekRecord_(week.weekNo) };
  } finally {
    lock.releaseLock();
  }
}

function handleAnalyzeWeek_(ctx, payload) {
  const weekNo = validateWeekNo_(payload.weekNo);
  const week = getWeekRecord_(weekNo);
  if (!week) throw apiError_('WEEK_NOT_CONFIGURED');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const advisory = generateWeekSchedule_(week);
    appendWeekLog_(weekNo, ctx.user.email, 'WEEK_ANALYZED', {
      teacherCount: advisory.teachers.length,
      sourceRows: advisory.sourceRows,
      duplicateRowsSkipped: advisory.duplicateRowsSkipped,
      skippedRows: advisory.skippedRows,
      lagCount: advisory.lags.length,
      allocatedRows: advisory.allocatedRows,
      alteredDayCount: advisory.alteredDayCount,
      localCampusCollisionCount: advisory.localCampusCollisionCount,
    });
    return advisory;
  } finally {
    lock.releaseLock();
  }
}

function handleSaveRaihanTeacherDays_(ctx, payload) {
  const weekNo = validateWeekNo_(payload.weekNo);
  const assignments = payload.assignments;
  const week = getWeekRecord_(weekNo);
  if (!week) throw apiError_('WEEK_NOT_CONFIGURED');
  if (!Array.isArray(assignments) || !assignments.length) throw apiError_('INVALID_PAYLOAD');
  const seen = {};
  const availableDays = {};
  raihanDates_(week).forEach(function (item) { availableDays[item.day] = true; });
  assignments.forEach(function (assignment) {
    const teacherId = String(assignment.teacherId || '').trim();
    const day = String(assignment.day || '').trim();
    if (!teacherId || WEEKDAYS_.indexOf(day) < 0 || seen[teacherId]) {
      throw apiError_('INVALID_PAYLOAD');
    }
    if (!availableDays[day]) throw apiError_('TEACHER_DAY_NOT_IN_WEEK');
    seen[teacherId] = day;
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateManagedSheet_('Raihan_Teacher_Days', [
      'Week_No', 'Teacher_ID', 'Teacher_Name', 'Raihan_Day', 'Updated_At', 'Updated_By',
    ]);
    const existing = sheet.getLastRow() < 2
      ? []
      : sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
    const retained = existing.filter(function (row) {
      return Number(row[0]) !== weekNo || !Object.prototype.hasOwnProperty.call(seen, String(row[1]));
    });
    const teacherNames = getSelectedWeekTeachers_(week);
    const rows = assignments.map(function (assignment) {
      const teacherId = String(assignment.teacherId).trim();
      if (!teacherNames[teacherId]) throw apiError_('RAIHAN_TEACHER_NOT_AVAILABLE');
      return [weekNo, teacherId, teacherNames[teacherId], seen[teacherId], new Date(), ctx.user.email];
    });
    replaceManagedRows_(sheet, [
      'Week_No', 'Teacher_ID', 'Teacher_Name', 'Raihan_Day', 'Updated_At', 'Updated_By',
    ], retained.concat(rows));
    appendWeekLog_(weekNo, ctx.user.email, 'RAIHAN_TEACHER_DAYS_SAVED', { assignments: rows.length });
    return { weekNo: weekNo, saved: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function getSelectedWeekTeachers_(week) {
  const teachers = {};
  buildWeekModel_(week).sessions.forEach(function (session) {
    if (session.status === 'RAIHAN_PENDING' && session.primary) teachers[session.primary.id] = session.primary.name;
  });
  return teachers;
}

function getRaihanTeacherDayOverrides_(weekNo) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Raihan_Teacher_Days');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  const overrides = {};
  rows.forEach(function (row) {
    if (Number(row[0]) === weekNo && WEEKDAYS_.indexOf(String(row[3])) >= 0) {
      overrides[String(row[1])] = String(row[3]);
    }
  });
  return overrides;
}

function handleListTemporaryTeachers_() {
  return { teachers: getTemporaryTeachers_() };
}

function handleSaveTemporaryTeacher_(ctx, payload) {
  const teacher = validateTemporaryTeacher_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getTemporaryTeacherSheet_();
    const rows = sheet.getLastRow() < 2
      ? []
      : sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    let rowIndex = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (String(rows[i][0]) === teacher.id) {
        rowIndex = i + 2;
        break;
      }
    }
    const row = [
      teacher.id,
      teacher.name,
      teacher.phone,
      JSON.stringify(teacher.subjects),
      JSON.stringify(teacher.availability),
      new Date(),
      ctx.user.email,
    ];
    if (rowIndex) sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    return { teacher: teacher };
  } finally {
    lock.releaseLock();
  }
}

function handleAssignTemporary_(ctx, payload) {
  const weekNo = validateWeekNo_(payload.weekNo);
  const week = getWeekRecord_(weekNo);
  if (!week) throw apiError_('WEEK_NOT_CONFIGURED');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const result = assignTemporaryTeachers_(week);
    appendWeekLog_(weekNo, ctx.user.email, 'TEMP_TEACHERS_ASSIGNED', {
      assigned: result.assigned,
      remaining: result.lags.length,
    });
    return result;
  } finally {
    lock.releaseLock();
  }
}

function handleGetFinalRaihanWeek_(ctx, payload) {
  const weekNo = validateWeekNo_(payload.weekNo);
  const week = getWeekRecord_(weekNo);
  if (!week) throw apiError_('WEEK_NOT_CONFIGURED');
  return getFinalRaihanWeek_(week);
}

function handleAssignRaihanLag_(ctx, payload) {
  const weekNo = validateWeekNo_(payload.weekNo);
  const rowNumber = Number(payload.rowNumber);
  let teacherId = String(payload.teacherId || '').trim();
  const period = normalizePeriod_(payload.period);
  const targetDate = String(payload.targetDate || '').trim();
  const requestedSubject = String(payload.subject || '').trim();
  const week = getWeekRecord_(weekNo);
  if (!week) throw apiError_('WEEK_NOT_CONFIGURED');
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || !teacherId ||
      RAIHAN_PERIODS_.indexOf(period) < 0) {
    throw apiError_('INVALID_PAYLOAD');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const working = getOrCreateManagedSheet_('Raihan_Solver_Working', [
      'Week_No', 'Status', 'Diagnostic', 'Source_Date', 'Source_Period', 'Class', 'Subject',
      'Teacher_ID', 'Teacher_Name', 'Assigned_Date', 'Assigned_Period', 'Musanid_JSON', 'Source_Row_JSON',
    ]);
    const workingRow = working.getRange(rowNumber, 1, 1, 13).getValues()[0];
    const movableStatuses = ['LAG', 'RAIHAN', 'TEMP_ASSIGNED', 'MANUAL_ASSIGNED'];
    if (Number(workingRow[0]) !== weekNo || movableStatuses.indexOf(String(workingRow[1])) < 0 ||
        week.classes.indexOf(String(workingRow[5])) < 0) {
      throw apiError_('LAG_NOT_AVAILABLE');
    }

    const allRows = working.getLastRow() < 2
      ? []
      : working.getRange(2, 1, working.getLastRow() - 1, 13).getValues();
    const teacherRows = allRows.filter(function (row) {
      return Number(row[0]) === weekNo &&
        ['RAIHAN', 'MANUAL_ASSIGNED'].indexOf(String(row[1])) >= 0 &&
        String(row[7]) === teacherId && row[9];
    });
    const isTemporaryTeacher = /^TEMP_/i.test(teacherId);
    const temporaryTeacher = isTemporaryTeacher ? getTemporaryTeacherById_(teacherId) : null;
    if (isTemporaryTeacher && !temporaryTeacher) {
      throw apiError_('TEMP_TEACHER_NOT_FOUND');
    }
    if (temporaryTeacher) teacherId = temporaryTeacher.id;
    const assignedDate = targetDate || rawDateToIso_(teacherRows[0] && teacherRows[0][9]);
    const assignedDay = rawDateToWeekday_(assignedDate);
    if (!isValidIsoDate_(assignedDate) || !raihanDates_(week).some(function (item) {
      return item.date === assignedDate;
    })) throw apiError_('RAIHAN_TEACHER_DAY_INVALID');
    if (temporaryTeacher) {
      if (!(temporaryTeacher.availability[assignedDay] || []).some(function (value) {
        return normalizePeriod_(value) === period;
      })) throw apiError_('TEMP_TEACHER_NOT_AVAILABLE');
    } else {
      if (!teacherRows.length) throw apiError_('RAIHAN_TEACHER_NOT_AVAILABLE');
      if (!teacherRows.some(function (row) {
        return rawDateToIso_(row[9]) === assignedDate;
      })) throw apiError_('RAIHAN_TEACHER_DAY_INVALID');
    }
    const subject = requestedSubject || String(workingRow[6]);
    if (!isRaihanSubject_(subject) && subject !== String(workingRow[6])) {
      throw apiError_('INVALID_RAIHAN_SUBJECT');
    }
    if (temporaryTeacher && !temporaryTeacher.subjects.some(function (value) {
      return value === '*' || normalizeSubjectKey_(value) === normalizeSubjectKey_(subject);
    })) throw apiError_('TEMP_TEACHER_SUBJECT_MISMATCH');

    const allocation = SpreadsheetApp.getActive().getSheetByName('Raihan_Allocations');
    if (!allocation || allocation.getLastRow() < 1) throw apiError_('SCHEDULE_NOT_GENERATED');
    const outputHeaders = allocation.getRange(1, 1, 1, allocation.getLastColumn()).getValues()[0]
      .map(function (value) { return String(value).trim().toLowerCase(); });
    const outputDateColumn = outputHeaders.indexOf('date');
    const outputPeriodColumn = outputHeaders.indexOf('period');
    const outputClassColumn = outputHeaders.indexOf('class');
    const outputSubjectColumn = outputHeaders.indexOf('subject');
    const outputTeacherColumn = outputHeaders.indexOf('mufawwaz/department');
    if ([outputDateColumn, outputPeriodColumn, outputClassColumn, outputSubjectColumn, outputTeacherColumn]
        .some(function (index) { return index < 0; })) {
      throw apiError_('SHEET_SCHEMA_MISCONFIGURED');
    }
    const allocationRows = allocation.getLastRow() < 2
      ? []
      : allocation.getRange(2, 1, allocation.getLastRow() - 1, outputHeaders.length).getValues();
    const target = String(workingRow[5]);
    const oldDate = rawDateToIso_(workingRow[9]);
    const oldPeriod = normalizePeriod_(workingRow[10]);
    let oldAllocationRowNumber = 0;
    if (String(workingRow[1]) !== 'LAG') {
      for (let i = 0; i < allocationRows.length; i += 1) {
        const row = allocationRows[i];
        if (Number(row[0]) === weekNo &&
            rawDateToIso_(row[outputDateColumn]) === oldDate &&
            normalizePeriod_(row[outputPeriodColumn]) === oldPeriod &&
            String(row[outputClassColumn]) === target &&
            String(row[outputSubjectColumn]) === String(workingRow[6]) &&
            (temporaryTeacher
              ? String(row[outputTeacherColumn]).indexOf(String(workingRow[7])) >= 0
              : parseTeacherAssignments_(row[outputTeacherColumn]).some(function (teacher) {
                return teacher.id === String(workingRow[7]);
              }))) {
          oldAllocationRowNumber = i + 2;
          break;
        }
      }
      if (!oldAllocationRowNumber) throw apiError_('LAG_NOT_AVAILABLE');
    }
    allocationRows.forEach(function (row) {
      if (Number(row[0]) !== weekNo || rawDateToIso_(row[outputDateColumn]) !== assignedDate ||
          normalizePeriod_(row[outputPeriodColumn]) !== period) return;
      if (oldAllocationRowNumber && row === allocationRows[oldAllocationRowNumber - 2]) return;
      if (String(row[outputClassColumn]) === target) throw apiError_('RAIHAN_CLASS_SLOT_OCCUPIED');
      if (week.classes.indexOf(String(row[outputClassColumn])) < 0) return;
      const occupiedTeacher = String(row[outputTeacherColumn] || '');
      if ((temporaryTeacher && occupiedTeacher.indexOf(teacherId) >= 0) ||
          parseTeacherAssignments_(occupiedTeacher).some(function (teacher) {
            return teacher.id === teacherId;
          })) throw apiError_('RAIHAN_TEACHER_SLOT_OCCUPIED');
    });

    let sourceRow;
    try {
      sourceRow = JSON.parse(String(workingRow[12] || '[]'));
    } catch (error) {
      throw apiError_('SOLVER_DATA_MISCONFIGURED');
    }
    const sourceHeaders = outputHeaders.slice(1);
    const sourcePeriodColumn = sourceHeaders.indexOf('period');
    const sourceDateColumn = sourceHeaders.indexOf('date');
    const sourceTeacherColumn = sourceHeaders.indexOf('mufawwaz/department');
    if ([sourcePeriodColumn, sourceDateColumn, sourceTeacherColumn].some(function (index) { return index < 0; }) ||
        sourceRow.length !== sourceHeaders.length) {
      throw apiError_('SOLVER_DATA_MISCONFIGURED');
    }
    const chosenTeacher = temporaryTeacher
      ? { 8: temporaryTeacher.name }
      : teacherRows[0];
    sourceRow[sourceHeaders.indexOf('subject')] = subject;
    sourceRow[sourceDateColumn] = isoToSheetDate_(assignedDate);
    sourceRow[sourcePeriodColumn] = formatPeriod_(period);
    sourceRow[sourceTeacherColumn] = teacherId + ' ' + String(chosenTeacher[8]);
    const outputRow = [weekNo].concat(sourceRow);
    if (oldAllocationRowNumber) {
      allocation.getRange(oldAllocationRowNumber, 1, 1, outputRow.length).setValues([outputRow]);
    } else {
      allocation.appendRow(outputRow);
    }

    const solverRow = workingRow.slice();
    solverRow[1] = 'MANUAL_ASSIGNED';
    solverRow[2] = 'Manually assigned in Raihan crosstab';
    solverRow[6] = subject;
    solverRow[7] = teacherId;
    solverRow[8] = String(chosenTeacher[8]);
    solverRow[9] = assignedDate;
    solverRow[10] = formatPeriod_(period);
    solverRow[12] = JSON.stringify(sourceRow);
    working.getRange(rowNumber, 1, 1, solverRow.length).setValues([solverRow]);
    appendWeekLog_(weekNo, ctx.user.email, 'RAIHAN_LAG_ASSIGNED', {
      className: target,
      subject: subject,
      teacherId: teacherId,
      period: formatPeriod_(period),
      date: assignedDate,
    });
    return getFinalRaihanWeek_(week);
  } finally {
    lock.releaseLock();
  }
}

function handleResolveCampusClash_(ctx, payload) {
  const weekNo = validateWeekNo_(payload.weekNo);
  const rowNumber = Number(payload.rowNumber);
  const targetDate = String(payload.targetDate || '').trim();
  const period = normalizePeriod_(payload.period);
  const week = getWeekRecord_(weekNo);
  if (!week) throw apiError_('WEEK_NOT_CONFIGURED');
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || !isValidIsoDate_(targetDate) ||
      targetDate < week.startDate || targetDate > week.endDate ||
      WEEKDAYS_.indexOf(rawDateToWeekday_(targetDate)) < 0 ||
      !period || Number(period.slice(1)) > SOURCE_PERIODS_PER_DAY_) {
    throw apiError_('INVALID_PAYLOAD');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const working = getOrCreateManagedSheet_('Raihan_Solver_Working', [
      'Week_No', 'Status', 'Diagnostic', 'Source_Date', 'Source_Period', 'Class', 'Subject',
      'Teacher_ID', 'Teacher_Name', 'Assigned_Date', 'Assigned_Period', 'Musanid_JSON', 'Source_Row_JSON',
    ]);
    const solverRow = working.getRange(rowNumber, 1, 1, 13).getValues()[0];
    const movableStatuses = ['KEPT', 'MOVED', 'CAMPUS_MANUAL'];
    const className = String(solverRow[5] || '');
    const subject = String(solverRow[6] || '');
    if (Number(solverRow[0]) !== weekNo || movableStatuses.indexOf(String(solverRow[1])) < 0 ||
        week.classes.indexOf(className) >= 0) {
      throw apiError_('CAMPUS_SESSION_NOT_AVAILABLE');
    }

    const allocation = SpreadsheetApp.getActive().getSheetByName('Raihan_Allocations');
    if (!allocation || allocation.getLastRow() < 1) throw apiError_('SCHEDULE_NOT_GENERATED');
    const outputHeaders = allocation.getRange(1, 1, 1, allocation.getLastColumn()).getValues()[0]
      .map(function (value) { return String(value).trim().toLowerCase(); });
    const dateColumn = outputHeaders.indexOf('date');
    const periodColumn = outputHeaders.indexOf('period');
    const classColumn = outputHeaders.indexOf('class');
    const teacherColumn = outputHeaders.indexOf('mufawwaz/department');
    if ([dateColumn, periodColumn, classColumn, teacherColumn].some(function (index) { return index < 0; })) {
      throw apiError_('SHEET_SCHEMA_MISCONFIGURED');
    }
    const allocationRows = allocation.getLastRow() < 2
      ? []
      : allocation.getRange(2, 1, allocation.getLastRow() - 1, outputHeaders.length).getValues();
    const oldDate = rawDateToIso_(solverRow[9]);
    const oldPeriod = normalizePeriod_(solverRow[10]);
    const teacherId = String(solverRow[7] || '');
    let oldAllocationRowNumber = 0;
    {
      for (let i = 0; i < allocationRows.length; i += 1) {
        const row = allocationRows[i];
        const teacherText = String(row[teacherColumn] || '');
        const hasTeacher = teacherId.indexOf('TEMP_') === 0
          ? teacherText.indexOf(teacherId) >= 0
          : parseTeacherAssignments_(teacherText).some(function (teacher) { return teacher.id === teacherId; });
        if (Number(row[0]) === weekNo && rawDateToIso_(row[dateColumn]) === oldDate &&
            normalizePeriod_(row[periodColumn]) === oldPeriod &&
            String(row[classColumn]) === className && hasTeacher) {
          oldAllocationRowNumber = i + 2;
          break;
        }
      }
      if (!oldAllocationRowNumber) throw apiError_('CAMPUS_SESSION_NOT_AVAILABLE');
    }
    allocationRows.forEach(function (row, index) {
      if (Number(row[0]) !== weekNo || rawDateToIso_(row[dateColumn]) !== targetDate ||
          normalizePeriod_(row[periodColumn]) !== period ||
          (oldAllocationRowNumber && index + 2 === oldAllocationRowNumber)) return;
      if (String(row[classColumn]) === className) throw apiError_('RAIHAN_CLASS_SLOT_OCCUPIED');
      const teacherText = String(row[teacherColumn] || '');
      if ((teacherId.indexOf('TEMP_') === 0 && teacherText.indexOf(teacherId) >= 0) ||
          parseTeacherAssignments_(teacherText).some(function (teacher) { return teacher.id === teacherId; })) {
        throw apiError_('RAIHAN_TEACHER_SLOT_OCCUPIED');
      }
    });

    let sourceRow;
    try {
      sourceRow = JSON.parse(String(solverRow[12] || '[]'));
    } catch (error) {
      throw apiError_('SOLVER_DATA_MISCONFIGURED');
    }
    const sourceHeaders = outputHeaders.slice(1);
    const sourceDateColumn = sourceHeaders.indexOf('date');
    const sourcePeriodColumn = sourceHeaders.indexOf('period');
    if (sourceRow.length !== sourceHeaders.length || sourceDateColumn < 0 || sourcePeriodColumn < 0) {
      throw apiError_('SOLVER_DATA_MISCONFIGURED');
    }
    sourceRow[sourceDateColumn] = isoToSheetDate_(targetDate);
    sourceRow[sourcePeriodColumn] = formatPeriod_(period);
    const outputRow = [weekNo].concat(sourceRow);
    if (oldAllocationRowNumber) {
      allocation.getRange(oldAllocationRowNumber, 1, 1, outputRow.length).setValues([outputRow]);
    } else {
      allocation.appendRow(outputRow);
    }

    solverRow[1] = 'CAMPUS_MANUAL';
    solverRow[2] = 'Manually resolved in the campus clash view';
    solverRow[9] = targetDate;
    solverRow[10] = formatPeriod_(period);
    solverRow[12] = JSON.stringify(sourceRow);
    working.getRange(rowNumber, 1, 1, solverRow.length).setValues([solverRow]);
    appendWeekLog_(weekNo, ctx.user.email, 'CAMPUS_CLASH_RESOLVED', {
      className: className,
      subject: subject,
      teacherId: teacherId,
      date: targetDate,
      period: formatPeriod_(period),
    });
    return getFinalRaihanWeek_(week);
  } finally {
    lock.releaseLock();
  }
}

function handleRecordWeekAction_(ctx, payload) {
  const weekNo = validateWeekNo_(payload.weekNo);
  const actions = {
    RAW_DATA_UPDATED: 'RAW_DATA_UPDATED',
    CHANGES_DONE_PROCEED: 'CHANGES_DONE_PROCEED',
  };
  const action = actions[payload.action];
  if (!action) throw apiError_('INVALID_ACTION');

  const sheet = getWeekSheet_();
  const rowIndex = findWeekRow_(sheet, weekNo);
  if (!rowIndex) throw apiError_('WEEK_NOT_CONFIGURED');

  const status = action === 'CHANGES_DONE_PROCEED' ? 'PROCEEDED' : 'SETUP';
  sheet.getRange(rowIndex, 5).setValue(status);
  sheet.getRange(rowIndex, 6, 1, 2).setValues([[new Date(), ctx.user.email]]);
  appendWeekLog_(weekNo, ctx.user.email, action, payload.details || {});
  return { weekNo: weekNo, status: status };
}

function validateWeekPayload_(payload) {
  const weekNo = validateWeekNo_(payload.weekNo);
  const startDate = String(payload.startDate || '').trim();
  const endDate = String(payload.endDate || '').trim();
  if (!isValidIsoDate_(startDate) || !isValidIsoDate_(endDate) || startDate > endDate) {
    throw apiError_('INVALID_DATE_RANGE');
  }
  if (!Array.isArray(payload.classes)) throw apiError_('INVALID_PAYLOAD');

  const classes = [];
  const seen = {};
  payload.classes.forEach(function (value) {
    const className = String(value || '').trim();
    if (className && !seen[className]) {
      seen[className] = true;
      classes.push(className);
    }
  });
  return {
    weekNo: weekNo,
    startDate: startDate,
    endDate: endDate,
    classes: classes,
    includeSaturday: payload.includeSaturday === true,
  };
}

function validateWeekNo_(value) {
  const weekNo = Number(value);
  if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > 41) throw apiError_('INVALID_WEEK');
  return weekNo;
}

function isValidIsoDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getWeekSheet_() {
  const headers = [
    'Week_No', 'Start_Date', 'End_Date', 'Classes_JSON', 'Status', 'Updated_At', 'Updated_By',
    'Include_Saturday',
  ];
  const existing = SpreadsheetApp.getActive().getSheetByName(RAIHAN_WEEKS_SHEET_);
  // Older sheets have 7 columns; add the Include_Saturday header in place.
  if (existing && existing.getLastRow() > 0 &&
      !String(existing.getRange(1, 8).getValues()[0][0] || '').trim()) {
    existing.getRange(1, 8).setValue('Include_Saturday');
  }
  return getOrCreateManagedSheet_(RAIHAN_WEEKS_SHEET_, headers);
}

function getWeekRecord_(weekNo) {
  const sheet = getWeekSheet_();
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rowIndex = findWeekRow_(sheet, weekNo);
  if (!rowIndex) return null;
  const row = sheet.getRange(rowIndex, 1, 1, 8).getValues()[0];
  let classes;
  try {
    classes = JSON.parse(String(row[3] || '[]'));
  } catch (error) {
    throw apiError_('WEEK_CONFIG_MISCONFIGURED');
  }
  if (!Array.isArray(classes)) throw apiError_('WEEK_CONFIG_MISCONFIGURED');
  return {
    weekNo: Number(row[0]),
    startDate: sheetDateToIso_(row[1]),
    endDate: sheetDateToIso_(row[2]),
    classes: classes,
    status: String(row[4] || 'SETUP'),
    includeSaturday: row[7] === true || String(row[7]).toUpperCase() === 'TRUE',
  };
}

function findWeekRow_(sheet, weekNo) {
  if (sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (Number(values[i][0]) === weekNo) return i + 2;
  }
  return 0;
}

function sheetDateToIso_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '').trim();
}

function getOrCreateManagedSheet_(name, headers) {
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0].map(function (value) {
    return String(value).trim().toLowerCase();
  });
  if (headers.some(function (header, index) {
    return actual[index] !== header.toLowerCase();
  })) throw apiError_('SHEET_SCHEMA_MISCONFIGURED');
  return sheet;
}

function appendWeekLog_(weekNo, email, action, details) {
  const sheet = getOrCreateManagedSheet_(RAIHAN_WEEK_LOGS_SHEET_, [
    'Week_No',
    'Timestamp',
    'User_Email',
    'Action',
    'Details_JSON',
  ]);
  sheet.appendRow([weekNo, new Date(), email, action, JSON.stringify(details || {})]);
}

/* ---- Raihan solver v2 -------------------------------------------------------------------
 *
 * Rules (agreed with the scheduling team):
 *  - A selected class is at Raihan for the WHOLE week. Its campus slots are free that week, so its
 *    own campus rows are never reported as clashes.
 *  - Held at Raihan: RAIHAN_SUBJECTS_ (includes Takhassus) plus RAIHAN_EXTRA_BOOKS_ (matched on
 *    the Book column). Khaimat Riyadat happens at Raihan outside the timetable. Every other
 *    lesson of a selected class is NOT_HELD that week (listed for information only).
 *  - One lead teacher travels per lesson: the first non-Musanid ID, else the first Musanid.
 *    Lessons with only a department (no teacher ID) are placed and staffed by that department.
 *  - Substitute (Proxy / Farmaan) rows already name the substitute, so they are used as-is.
 *  - Raihan lessons use RAIHAN_PERIODS_ (P2-P10; PT is Khaimat). Saturday only when the week
 *    has Include_Saturday ticked.
 *  - Objective, in priority order: place every lesson; give each teacher as few Raihan days as
 *    possible; keep a TRAVEL_GAP_MINUTES_ gap between a teacher's campus and Raihan lessons on
 *    the same day; prefer P2/P4/P6.
 *  - The source timetable is never edited. Campus lessons that break the travel gap are reported
 *    with suggested swaps for staff to approve and apply in JHS_Raw_Data.
 */

const RAIHAN_EXTRA_BOOKS_ = ['Academic Writing', 'Essay', 'Emotional Intelligence and Leadership Skills'];
const RAIHAN_OUTSIDE_JADWAL_SUBJECTS_ = ['Khaimat Riyadat'];
const RAIHAN_PREFERRED_PERIODS_ = ['P2', 'P4', 'P6'];
const TRAVEL_GAP_MINUTES_ = 120;
// Bell schedule (minutes after midnight). PT 6:00-7:00, Dua 8:30, breaks 10:35 and 12:40-14:00.
const PERIOD_TIMES_ = {
  P1: [360, 420], P2: [530, 565], P3: [565, 600], P4: [600, 635], P5: [655, 690],
  P6: [690, 725], P7: [725, 760], P8: [840, 875], P9: [875, 910], P10: [910, 945],
};
const SOLVER_WEIGHTS_ = {
  unplaced: 100000, // a lesson with no Raihan slot
  day: 1000, // each Raihan day a teacher must travel
  overrideDay: 20000, // using a day other than the scheduler's chosen day (a human choice wins)
  clash: 300, // each campus lesson that breaks the travel gap
  nonPreferredPeriod: 1, // tie-break towards P2/P4/P6
};
const SOLVER_TIME_LIMIT_MS_ = 45000; // Apps Script allows 6 minutes per request

function periodsClash_(a, b) {
  if (a === b) return true;
  const x = PERIOD_TIMES_[a];
  const y = PERIOD_TIMES_[b];
  if (!x || !y) return true;
  return !(x[1] + TRAVEL_GAP_MINUTES_ <= y[0] || y[1] + TRAVEL_GAP_MINUTES_ <= x[0]);
}

function raihanDates_(week) {
  const dates = [];
  for (let date = week.startDate; date <= week.endDate; date = addIsoDays_(date, 1)) {
    const day = rawDateToWeekday_(date);
    if (WEEKDAYS_.indexOf(day) < 0) continue;
    if (day === 'Saturday' && !week.includeSaturday) continue;
    dates.push({ date: date, day: day });
  }
  return dates;
}

function isHeldAtRaihan_(subject, book) {
  if (isRaihanSubject_(subject)) return true;
  const key = normalizeSubjectKey_(book);
  return Boolean(key) && RAIHAN_EXTRA_BOOKS_.some(function (value) {
    return normalizeSubjectKey_(value) === key;
  });
}

function isOutsideJadwal_(subject) {
  const key = normalizeSubjectKey_(subject);
  return RAIHAN_OUTSIDE_JADWAL_SUBJECTS_.some(function (value) { return normalizeSubjectKey_(value) === key; });
}

function leadTeacher_(assignments) {
  return assignments.filter(function (item) { return !item.isMusanid; })[0] || assignments[0] || null;
}

function seededRandom_(seed) {
  let state = (seed >>> 0) || 1;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reads JHS_Raw_Data for the week and collapses repeated rows into lesson sessions. */
function buildWeekModel_(week) {
  const source = SpreadsheetApp.getActive().getSheetByName(RAW_DATA_SHEET_);
  if (!source) throw apiError_('RAW_DATA_MISSING');
  const dataRange = source.getDataRange();
  const values = dataRange.getValues();
  const displayValues = dataRange.getDisplayValues();
  if (!values.length) throw apiError_('RAW_DATA_MISCONFIGURED');
  const sourceHeaders = values[0].map(function (value) { return String(value).trim(); });
  const headers = sourceHeaders.map(function (value) { return value.toLowerCase(); });
  const columns = {
    period: headers.indexOf('period'),
    className: headers.indexOf('class'),
    subject: headers.indexOf('subject'),
    teacher: headers.indexOf('mufawwaz/department'),
    date: headers.indexOf('date'),
  };
  if (Object.keys(columns).some(function (key) { return columns[key] < 0; })) {
    throw apiError_('RAW_DATA_MISCONFIGURED');
  }
  columns.book = headers.indexOf('book');

  const selected = {};
  week.classes.forEach(function (className) { selected[className] = true; });
  const skippedRows = {
    invalidDate: 0, invalidWeekday: 0, invalidClass: 0, invalidPeriod: 0, invalidSubject: 0, invalidTeacher: 0,
  };
  const bySlot = {};
  const invalidDateSamples = [];
  const validDateSamples = [];
  const invalidScheduleSamples = [];
  let duplicateRowsSkipped = 0;
  let validDateRows = 0;
  let rowsInDateRange = 0;
  let earliestValidDate = '';
  let latestValidDate = '';

  values.slice(1).forEach(function (sourceRow, rowIndex) {
    const rawDate = sourceRow[columns.date];
    const displayedDate = displayValues[rowIndex + 1][columns.date];
    const date = rawDateToIso_(rawDate) || rawDateToIso_(displayedDate);
    if (!date) {
      if (sourceRow.some(function (cell) { return String(cell || '').trim(); })) {
        skippedRows.invalidDate += 1;
        if (invalidDateSamples.length < 5) {
          invalidDateSamples.push({
            row: rowIndex + 2,
            rawValue: String(rawDate || '').slice(0, 80),
            displayedValue: String(displayedDate || '').slice(0, 80),
          });
        }
      }
      return;
    }
    validDateRows += 1;
    if (!earliestValidDate || date < earliestValidDate) earliestValidDate = date;
    if (!latestValidDate || date > latestValidDate) latestValidDate = date;
    if (validDateSamples.length < 5) {
      validDateSamples.push({ row: rowIndex + 2, parsedDate: date, displayedValue: String(displayedDate || '').slice(0, 80) });
    }
    if (date < week.startDate || date > week.endDate) return;
    rowsInDateRange += 1;
    const className = String(sourceRow[columns.className] || '').trim();
    const period = normalizePeriod_(sourceRow[columns.period]);
    const subject = String(sourceRow[columns.subject] || '').trim();
    const teacherText = String(sourceRow[columns.teacher] || '').trim();
    const assignments = parseTeacherAssignments_(teacherText);
    const book = columns.book >= 0 ? String(sourceRow[columns.book] || '').trim() : '';
    if (!className) skippedRows.invalidClass += 1;
    if (!period) skippedRows.invalidPeriod += 1;
    if (!subject) skippedRows.invalidSubject += 1;
    if ((!period || !subject) && invalidScheduleSamples.length < 8) {
      const displayRow = displayValues[rowIndex + 1];
      invalidScheduleSamples.push({
        row: rowIndex + 2,
        className: className.slice(0, 80),
        subject: subject.slice(0, 80),
        periodRaw: String(sourceRow[columns.period] || '').slice(0, 80),
        periodDisplayed: String(displayRow[columns.period] || '').slice(0, 80),
        teacherRaw: teacherText.slice(0, 120),
        teacherDisplayed: String(displayRow[columns.teacher] || '').slice(0, 120),
        invalidPeriod: !period,
        invalidSubject: !subject,
        invalidTeacher: false,
      });
    }
    if (!className || !period || !subject) return;
    const day = rawDateToWeekday_(date);
    if (WEEKDAYS_.indexOf(day) < 0) {
      skippedRows.invalidWeekday += 1;
      return;
    }

    const key = [date, period, className, subject].join('|');
    let session = bySlot[key];
    if (session) {
      duplicateRowsSkipped += 1;
      session.sourceRows.push(rowIndex + 2);
    } else {
      const row = sourceRow.slice();
      row[columns.date] = date;
      row[columns.period] = period;
      row[columns.className] = className;
      row[columns.subject] = subject;
      session = bySlot[key] = {
        key: key, sourceRows: [rowIndex + 2], row: row, date: date, day: day, period: period,
        className: className, subject: subject, book: book, department: '', assignments: [],
        selected: Boolean(selected[className]), status: 'SOURCE', diagnostic: '',
        assignedDate: date, assignedPeriod: period,
      };
    }
    if (!session.book && book) session.book = book;
    if (!assignments.length && teacherText && !session.department) session.department = teacherText;
    assignments.forEach(function (assignment) {
      if (!session.assignments.some(function (saved) { return saved.id === assignment.id; })) {
        session.assignments.push(assignment);
      }
    });
  });

  const sessions = [];
  Object.keys(bySlot).forEach(function (key) {
    const session = bySlot[key];
    if (!session.assignments.length && !session.department) {
      skippedRows.invalidTeacher += 1;
      return;
    }
    session.musanids = session.assignments.filter(function (item) { return item.isMusanid; });
    session.primary = leadTeacher_(session.assignments);
    session.row[columns.teacher] = session.assignments.length
      ? formatTeacherAssignments_(session.assignments)
      : session.department;
    if (session.selected) {
      if (isOutsideJadwal_(session.subject)) session.status = 'OUTSIDE_JADWAL';
      else if (isHeldAtRaihan_(session.subject, session.book)) session.status = 'RAIHAN_PENDING';
      else session.status = 'NOT_HELD';
    } else {
      session.status = 'KEPT';
    }
    sessions.push(session);
  });
  sessions.sort(function (a, b) {
    return a.className.localeCompare(b.className) || a.date.localeCompare(b.date) ||
      Number(a.period.slice(1)) - Number(b.period.slice(1)) || a.subject.localeCompare(b.subject);
  });

  return {
    sourceHeaders: sourceHeaders,
    columns: columns,
    sessions: sessions,
    diagnostics: {
      validDateRows: validDateRows, earliestValidDate: earliestValidDate, latestValidDate: latestValidDate,
      validDateSamples: validDateSamples, rowsInDateRange: rowsInDateRange,
      duplicateRowsSkipped: duplicateRowsSkipped, skippedRows: skippedRows,
      invalidDateSamples: invalidDateSamples, invalidScheduleSamples: invalidScheduleSamples,
    },
  };
}

/**
 * Pure optimiser. Places every RAIHAN_PENDING session into (date, period) so that no class or lead
 * teacher is double-booked at Raihan, then minimises SOLVER_WEIGHTS_ cost by simulated annealing.
 */
function solveRaihanPlacement_(sessions, dates, options) {
  const opts = options || {};
  const overrides = opts.teacherDayOverrides || {};
  const random = seededRandom_(opts.seed || 1);
  const timeLimit = opts.timeLimitMs || SOLVER_TIME_LIMIT_MS_;
  const maxIterations = opts.maxIterations || 3000000;
  const periods = RAIHAN_PERIODS_;
  const D = dates.length;
  const P = periods.length;
  const W = SOLVER_WEIGHTS_;
  const raihan = sessions.filter(function (session) { return session.status === 'RAIHAN_PENDING'; });
  const dateIndex = {};
  dates.forEach(function (item, index) { dateIndex[item.date] = index; });

  // Campus commitments of every lead teacher, per Raihan date.
  const leadIds = {};
  raihan.forEach(function (session) { if (session.primary) leadIds[session.primary.id] = true; });
  const campus = {};
  sessions.forEach(function (session) {
    if (session.status !== 'KEPT' || dateIndex[session.date] === undefined) return;
    session.assignments.forEach(function (assignment) {
      if (!leadIds[assignment.id]) return;
      if (!campus[assignment.id]) campus[assignment.id] = [];
      const byDate = campus[assignment.id];
      const d = dateIndex[session.date];
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(session);
    });
  });

  const classIds = {};
  const teacherIds = {};
  const classNames = [];
  const teacherNames = [];
  raihan.forEach(function (session) {
    if (classIds[session.className] === undefined) {
      classIds[session.className] = classNames.length;
      classNames.push(session.className);
    }
    const teacherId = session.primary ? session.primary.id : '';
    if (teacherId && teacherIds[teacherId] === undefined) {
      teacherIds[teacherId] = teacherNames.length;
      teacherNames.push(teacherId);
    }
  });
  const N = raihan.length;
  const cls = raihan.map(function (session) { return classIds[session.className]; });
  const tch = raihan.map(function (session) { return session.primary ? teacherIds[session.primary.id] : -1; });
  const classGrid = classNames.map(function () { return new Int32Array(D * P).fill(-1); });
  const teacherGrid = teacherNames.map(function () { return new Int32Array(D * P).fill(-1); });
  const slot = new Int32Array(N).fill(-1);
  const sessionsOfTeacher = teacherNames.map(function () { return []; });
  tch.forEach(function (t, i) { if (t >= 0) sessionsOfTeacher[t].push(i); });
  const preferred = periods.map(function (period) { return RAIHAN_PREFERRED_PERIODS_.indexOf(period) >= 0; });
  const overrideDate = teacherNames.map(function (teacherId) {
    const day = overrides[teacherId];
    if (!day) return -1;
    for (let d = 0; d < D; d += 1) if (dates[d].day === day) return d;
    return -1;
  });
  const campusPeriods = teacherNames.map(function (teacherId) {
    const byDate = campus[teacherId] || [];
    const result = [];
    for (let d = 0; d < D; d += 1) {
      result.push((byDate[d] || []).map(function (session) { return session.period; }));
    }
    return result;
  });
  const clashTable = periods.map(function (raihanPeriod) {
    const row = {};
    Object.keys(PERIOD_TIMES_).forEach(function (campusPeriod) { row[campusPeriod] = periodsClash_(raihanPeriod, campusPeriod); });
    return row;
  });

  function teacherCost(t) {
    if (t < 0) return 0;
    let cost = 0;
    const grid = teacherGrid[t];
    for (let d = 0; d < D; d += 1) {
      let used = false;
      const clashMarks = {};
      let clashes = 0;
      for (let p = 0; p < P; p += 1) {
        if (grid[d * P + p] < 0) continue;
        used = true;
        if (!preferred[p]) cost += W.nonPreferredPeriod;
        const list = campusPeriods[t][d];
        for (let k = 0; k < list.length; k += 1) {
          if (!clashMarks[k] && clashTable[p][list[k]]) {
            clashMarks[k] = true;
            clashes += 1;
          }
        }
      }
      if (used) {
        cost += W.day + clashes * W.clash;
        if (overrideDate[t] >= 0 && overrideDate[t] !== d) cost += W.overrideDay;
      }
    }
    return cost;
  }
  function unplacedCost(i) {
    // A scheduler-chosen teacher must not be dropped just to save their trip.
    return W.unplaced + (tch[i] >= 0 && overrideDate[tch[i]] >= 0 ? W.overrideDay : 0);
  }
  function dayFreeCost(i) {
    // Department-staffed lessons only carry the period preference.
    return slot[i] >= 0 && !preferred[slot[i] % P] ? W.nonPreferredPeriod : 0;
  }
  function put(i, s) {
    slot[i] = s;
    if (s < 0) return;
    classGrid[cls[i]][s] = i;
    if (tch[i] >= 0) teacherGrid[tch[i]][s] = i;
  }
  function lift(i) {
    const s = slot[i];
    if (s < 0) return;
    classGrid[cls[i]][s] = -1;
    if (tch[i] >= 0) teacherGrid[tch[i]][s] = -1;
    slot[i] = -1;
  }
  function canTake(i, s) {
    return classGrid[cls[i]][s] < 0 && (tch[i] < 0 || teacherGrid[tch[i]][s] < 0);
  }

  // Greedy start: biggest teachers first, each on their override day or least busy campus day.
  const order = [];
  for (let i = 0; i < N; i += 1) order.push(i);
  const teacherLoad = sessionsOfTeacher.map(function (list) { return list.length; });
  order.sort(function (a, b) {
    return (tch[b] >= 0 ? teacherLoad[tch[b]] : 0) - (tch[a] >= 0 ? teacherLoad[tch[a]] : 0) || a - b;
  });
  order.forEach(function (i) {
    let best = -1;
    let bestCost = Infinity;
    for (let s = 0; s < D * P; s += 1) {
      if (!canTake(i, s)) continue;
      put(i, s);
      const cost = tch[i] >= 0 ? teacherCost(tch[i]) : dayFreeCost(i);
      lift(i);
      if (cost < bestCost) { bestCost = cost; best = s; }
    }
    if (best >= 0) put(i, best);
  });

  // Simulated annealing over relocations and swaps.
  const tCost = teacherNames.map(function (name, t) { return teacherCost(t); });
  function totalCost() {
    let cost = 0;
    for (let i = 0; i < N; i += 1) {
      if (slot[i] < 0) cost += unplacedCost(i);
      else if (tch[i] < 0) cost += dayFreeCost(i);
    }
    return cost + tCost.reduce(function (sum, value) { return sum + value; }, 0);
  }
  let current = totalCost();
  let best = current;
  let bestSlots = Int32Array.from(slot);
  const started = Date.now();
  const startTemp = 800;
  let iterations = 0;
  if (N && D) {
    let temperature = startTemp;
    for (; iterations < maxIterations; iterations += 1) {
      if ((iterations & 1023) === 0) {
        // Cool by whichever runs out first, iterations or wall-clock time, so a slow runtime
        // (Apps Script is slower than a laptop) still finishes the full cooling schedule.
        const progress = Math.max(iterations / maxIterations, (Date.now() - started) / timeLimit);
        if (progress >= 1) break;
        temperature = startTemp * Math.pow(0.002, progress);
      }
      const i = Math.floor(random() * N);
      let s;
      const t = tch[i];
      if (t >= 0 && random() < 0.6) {
        // Stay on one of the teacher's current days most of the time.
        const peers = sessionsOfTeacher[t];
        const peer = peers[Math.floor(random() * peers.length)];
        const d = slot[peer] >= 0 ? Math.floor(slot[peer] / P) : Math.floor(random() * D);
        s = d * P + Math.floor(random() * P);
      } else {
        s = Math.floor(random() * D * P);
      }
      const from = slot[i];
      if (s === from) continue;
      const j = classGrid[cls[i]][s]; // class occupant to swap or bump
      if (t >= 0) {
        const busy = teacherGrid[t][s];
        if (busy >= 0 && busy !== j) continue;
      }
      if (j >= 0 && from >= 0 && tch[j] >= 0 && tch[j] !== t) {
        const busyJ = teacherGrid[tch[j]][from];
        if (busyJ >= 0 && busyJ !== i) continue;
      }
      const touched = {};
      if (t >= 0) touched[t] = true;
      if (j >= 0 && tch[j] >= 0) touched[tch[j]] = true;
      let before = 0;
      Object.keys(touched).forEach(function (key) { before += tCost[key]; });
      if (from < 0) before += unplacedCost(i); else if (t < 0) before += dayFreeCost(i);
      if (j >= 0 && tch[j] < 0) before += dayFreeCost(j);
      lift(i);
      if (j >= 0) lift(j);
      put(i, s);
      if (j >= 0) put(j, from); // from === -1 bumps j to unplaced
      const newCosts = {};
      let after = 0;
      Object.keys(touched).forEach(function (key) {
        newCosts[key] = teacherCost(Number(key));
        after += newCosts[key];
      });
      if (t < 0) after += dayFreeCost(i);
      if (j >= 0) {
        if (slot[j] < 0) after += unplacedCost(j);
        else if (tch[j] < 0) after += dayFreeCost(j);
      }
      const delta = after - before;
      if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
        Object.keys(newCosts).forEach(function (key) { tCost[key] = newCosts[key]; });
        current += delta;
        if (current < best) {
          best = current;
          bestSlots = Int32Array.from(slot);
        }
      } else {
        lift(i);
        if (j >= 0) lift(j);
        put(i, from);
        if (j >= 0) put(j, s);
      }
    }
  }
  for (let i = 0; i < N; i += 1) lift(i);
  for (let i = 0; i < N; i += 1) if (bestSlots[i] >= 0) put(i, bestSlots[i]);

  // Report.
  const capacity = D * P;
  const demand = {};
  raihan.forEach(function (session) { demand[session.className] = (demand[session.className] || 0) + 1; });
  raihan.forEach(function (session, i) {
    if (slot[i] >= 0) {
      session.status = 'RAIHAN';
      session.assignedDate = dates[Math.floor(slot[i] / P)].date;
      session.assignedPeriod = periods[slot[i] % P];
      session.diagnostic = session.primary ? '' : 'Staffed by department';
    } else {
      session.status = 'LAG';
      session.assignedDate = session.date;
      session.assignedPeriod = session.period;
      session.diagnostic = demand[session.className] > capacity
        ? 'Class needs ' + demand[session.className] + ' Raihan periods; only ' + capacity + ' slots this week'
        : 'No common free slot for class and teacher';
    }
  });
  return {
    iterations: iterations,
    elapsedMs: Date.now() - started,
    cost: best,
    capacityPerClass: capacity,
    demandByClass: demand,
    campusByTeacher: campus,
    dateIndex: dateIndex,
  };
}

/** Campus lessons of each lead teacher that break the travel gap on their Raihan days. */
function findTravelClashes_(sessions, campusByTeacher, dateIndex) {
  const raihanByTeacherDate = {};
  sessions.forEach(function (session) {
    if (session.status !== 'RAIHAN' || !session.primary) return;
    const key = session.primary.id + '|' + session.assignedDate;
    if (!raihanByTeacherDate[key]) raihanByTeacherDate[key] = [];
    raihanByTeacherDate[key].push(session);
  });
  const clashes = [];
  Object.keys(raihanByTeacherDate).forEach(function (key) {
    const parts = key.split('|');
    const teacherId = parts[0];
    const date = parts[1];
    const raihanSessions = raihanByTeacherDate[key];
    const campusSessions = ((campusByTeacher[teacherId] || [])[dateIndex[date]]) || [];
    campusSessions.forEach(function (campusSession) {
      const hits = raihanSessions.filter(function (raihanSession) {
        return periodsClash_(raihanSession.assignedPeriod, campusSession.period);
      });
      if (!hits.length) return;
      hits.sort(function (a, b) {
        return Math.abs(Number(a.assignedPeriod.slice(1)) - Number(campusSession.period.slice(1))) -
          Math.abs(Number(b.assignedPeriod.slice(1)) - Number(campusSession.period.slice(1)));
      });
      const hit = hits[0];
      clashes.push({
        teacherId: teacherId,
        teacherName: hit.primary.name,
        raihanDay: rawDateToWeekday_(hit.assignedDate),
        raihanDate: hit.assignedDate,
        raihanPeriod: formatPeriod_(hit.assignedPeriod),
        raihanClass: hit.className,
        raihanSubject: hit.subject,
        sourceRows: campusSession.sourceRows,
        collisionReason: hit.assignedPeriod === campusSession.period
          ? 'Same period'
          : 'Less than ' + (TRAVEL_GAP_MINUTES_ / 60) + 'h travel gap',
        localDay: campusSession.day,
        localDate: campusSession.date,
        localPeriod: formatPeriod_(campusSession.period),
        localClass: campusSession.className,
        localSubject: campusSession.subject,
        campusKey: campusSession.key,
      });
    });
  });
  clashes.sort(function (a, b) {
    return a.raihanDate.localeCompare(b.raihanDate) ||
      Number(a.localPeriod.replace(/\D/g, '')) - Number(b.localPeriod.replace(/\D/g, '')) ||
      a.teacherName.localeCompare(b.teacherName) || a.localClass.localeCompare(b.localClass);
  });
  return clashes;
}

/**
 * Suggests, for each clashing campus lesson, a swap with another lesson of the same campus class
 * (same day first) or a move into a free period, so the traveling teacher keeps the gap. Accepted
 * suggestions are applied to a working copy, so the list is consistent as a whole.
 */
function suggestCampusSwaps_(sessions, clashes) {
  const campus = sessions.filter(function (session) { return session.status === 'KEPT'; });
  const byKey = {};
  campus.forEach(function (session) {
    byKey[session.key] = { session: session, date: session.date, period: session.period };
  });
  const teacherCampus = {}; // teacherId|date|period -> count
  const classCampus = {}; // class|date|period -> lesson key
  const classMaxPeriod = {}; // class|date -> highest period used
  function teacherIdsOf(session) {
    return session.assignments.filter(function (item) { return !item.isMusanid; }).map(function (item) { return item.id; });
  }
  function index(entry, delta) {
    teacherIdsOf(entry.session).forEach(function (id) {
      const key = id + '|' + entry.date + '|' + entry.period;
      teacherCampus[key] = (teacherCampus[key] || 0) + delta;
    });
    const classKey = entry.session.className + '|' + entry.date + '|' + entry.period;
    if (delta > 0) classCampus[classKey] = entry.session.key;
    else if (classCampus[classKey] === entry.session.key) delete classCampus[classKey];
  }
  Object.keys(byKey).forEach(function (key) {
    const entry = byKey[key];
    index(entry, 1);
    const dayKey = entry.session.className + '|' + entry.date;
    classMaxPeriod[dayKey] = Math.max(classMaxPeriod[dayKey] || 0, Number(entry.period.slice(1)));
  });
  const raihanByTeacherDate = {};
  sessions.forEach(function (session) {
    if (session.status !== 'RAIHAN' || !session.primary) return;
    const key = session.primary.id + '|' + session.assignedDate;
    if (!raihanByTeacherDate[key]) raihanByTeacherDate[key] = [];
    raihanByTeacherDate[key].push(session.assignedPeriod);
  });
  function teacherCanBeAt(teacherId, date, period, ignoreKey) {
    const ignore = ignoreKey && byKey[ignoreKey];
    let count = teacherCampus[teacherId + '|' + date + '|' + period] || 0;
    if (ignore && ignore.date === date && ignore.period === period &&
        teacherIdsOf(ignore.session).indexOf(teacherId) >= 0) count -= 1;
    if (count > 0) return false;
    return !(raihanByTeacherDate[teacherId + '|' + date] || []).some(function (raihanPeriod) {
      return periodsClash_(raihanPeriod, period);
    });
  }
  const dates = {};
  campus.forEach(function (session) { dates[session.date] = true; });
  const dateList = Object.keys(dates).sort();
  const describe = function (entry) {
    return {
      className: entry.session.className,
      subject: entry.session.subject,
      day: rawDateToWeekday_(entry.date),
      date: entry.date,
      period: formatPeriod_(entry.period),
      teachers: entry.session.assignments.length
        ? entry.session.assignments.map(function (item) { return item.id + ' ' + item.name; }).join(' / ')
        : entry.session.department,
      sourceRows: entry.session.sourceRows,
    };
  };

  const seen = {};
  const suggestions = [];
  clashes.forEach(function (clash) {
    if (seen[clash.campusKey + '|' + clash.teacherId]) return;
    seen[clash.campusKey + '|' + clash.teacherId] = true;
    const entry = byKey[clash.campusKey];
    if (!entry) return;
    const lesson = entry.session;
    const result = {
      teacherId: clash.teacherId,
      teacherName: clash.teacherName,
      reason: clash.collisionReason,
      raihanSlot: clash.raihanDay + ' ' + clash.raihanDate + ' ' + clash.raihanPeriod,
      lesson: describe(entry),
      action: 'NEEDS_SUBSTITUTE',
      options: [],
    };
    const others = teacherIdsOf(lesson).filter(function (id) { return id !== clash.teacherId; });
    if (others.length) {
      result.action = 'GROUP_COVER';
      result.note = 'Group lesson: ' + others.length + ' other teacher(s) continue; ' + clash.teacherName + ' is excused.';
      suggestions.push(result);
      return;
    }
    const lessonTeachers = teacherIdsOf(lesson);
    const candidates = [];
    dateList.forEach(function (date) {
      for (let number = 1; number <= SOURCE_PERIODS_PER_DAY_; number += 1) {
        const period = 'P' + number;
        if (date === entry.date && period === entry.period) continue;
        const max = classMaxPeriod[lesson.className + '|' + date] || 0;
        if (!max || number > max) continue;
        if (!lessonTeachers.every(function (id) { return teacherCanBeAt(id, date, period, lesson.key); })) continue;
        const partnerKey = classCampus[lesson.className + '|' + date + '|' + period];
        const partner = partnerKey && byKey[partnerKey];
        if (partner) {
          const partnerTeachers = teacherIdsOf(partner.session);
          if (!partnerTeachers.every(function (id) {
            return teacherCanBeAt(id, entry.date, entry.period, partner.session.key);
          })) continue;
        }
        candidates.push({
          date: date, period: period, partner: partner || null,
          score: (date === entry.date ? 0 : 100) + (partner ? 0 : 5) +
            Math.abs(number - Number(entry.period.slice(1))),
        });
      }
    });
    candidates.sort(function (a, b) { return a.score - b.score || a.date.localeCompare(b.date); });
    result.options = candidates.slice(0, 3).map(function (candidate) {
      return {
        type: candidate.partner ? 'SWAP' : 'MOVE_TO_FREE_PERIOD',
        target: { day: rawDateToWeekday_(candidate.date), date: candidate.date, period: formatPeriod_(candidate.period) },
        swapWith: candidate.partner ? describe(candidate.partner) : null,
      };
    });
    if (candidates.length) {
      const chosen = candidates[0];
      result.action = chosen.partner ? 'SWAP' : 'MOVE_TO_FREE_PERIOD';
      // Apply to the working copy so later suggestions respect this one.
      index(entry, -1);
      if (chosen.partner) index(chosen.partner, -1);
      const oldDate = entry.date;
      const oldPeriod = entry.period;
      entry.date = chosen.date;
      entry.period = chosen.period;
      if (chosen.partner) {
        chosen.partner.date = oldDate;
        chosen.partner.period = oldPeriod;
      }
      index(entry, 1);
      if (chosen.partner) index(chosen.partner, 1);
    }
    suggestions.push(result);
  });
  return suggestions;
}

function generateWeekSchedule_(week) {
  const model = buildWeekModel_(week);
  const sessions = model.sessions;
  const dates = raihanDates_(week);
  const overrides = getRaihanTeacherDayOverrides_(week.weekNo);
  const solve = solveRaihanPlacement_(sessions, dates, {
    teacherDayOverrides: overrides,
    seed: week.weekNo * 7919 + 17,
  });
  const clashes = findTravelClashes_(sessions, solve.campusByTeacher, solve.dateIndex);
  const swaps = suggestCampusSwaps_(sessions, clashes);

  // Teacher summaries (lead teachers of Raihan lessons).
  const teachers = {};
  sessions.forEach(function (session) {
    if (['RAIHAN', 'LAG'].indexOf(session.status) < 0 || !session.primary) return;
    const id = session.primary.id;
    if (!teachers[id]) {
      teachers[id] = { teacherId: id, teacherName: session.primary.name, classes: {}, raihanSessions: 0, days: {}, homeByDay: {} };
      WEEKDAYS_.forEach(function (day) { teachers[id].homeByDay[day] = 0; });
      ((solve.campusByTeacher[id]) || []).forEach(function (list, d) {
        if (list) teachers[id].homeByDay[dates[d].day] = list.length;
      });
    }
    const teacher = teachers[id];
    teacher.classes[session.className] = true;
    teacher.raihanSessions += 1;
    if (session.status === 'RAIHAN') teacher.days[rawDateToWeekday_(session.assignedDate)] = true;
  });
  const clashesByTeacher = {};
  clashes.forEach(function (clash) {
    if (!clashesByTeacher[clash.teacherId]) clashesByTeacher[clash.teacherId] = [];
    clashesByTeacher[clash.teacherId].push(clash);
  });

  const allocated = sessions.filter(function (session) {
    return ['KEPT', 'RAIHAN'].indexOf(session.status) >= 0;
  });
  writeWeekOutput_(week.weekNo, model.sourceHeaders, model.columns, allocated);
  writeSolverWorking_(week.weekNo, sessions, model.columns.date, model.columns.period);

  const lags = sessions.filter(function (session) { return session.status === 'LAG'; }).map(function (session) {
    return {
      className: session.className,
      subject: session.subject,
      book: session.book,
      teacherId: session.primary ? session.primary.id : '',
      teacherName: session.primary ? session.primary.name : session.department,
      date: session.date,
      period: formatPeriod_(session.period),
      diagnostic: session.diagnostic,
    };
  });
  const lagBySubject = {};
  lags.forEach(function (lag) { lagBySubject[lag.subject] = (lagBySubject[lag.subject] || 0) + 1; });
  const notHeld = sessions.filter(function (session) { return session.status === 'NOT_HELD'; }).map(function (session) {
    return {
      className: session.className, subject: session.subject, book: session.book,
      date: session.date, period: formatPeriod_(session.period),
    };
  });
  const placed = sessions.filter(function (session) { return session.status === 'RAIHAN'; });
  const teacherList = Object.keys(teachers).map(function (id) {
    const teacher = teachers[id];
    const days = WEEKDAYS_.filter(function (day) { return teacher.days[day]; });
    const suggested = days.slice().sort(function (a, b) {
      return teacher.homeByDay[a] - teacher.homeByDay[b];
    })[0] || '';
    return {
      teacherId: id,
      teacherName: teacher.teacherName,
      classes: Object.keys(teacher.classes).sort(),
      raihanSessions: teacher.raihanSessions,
      raihanDay: overrides[id] && days.indexOf(overrides[id]) >= 0 ? overrides[id] : (days[0] ? suggested : ''),
      raihanDays: days,
      localCampusCollisionCount: (clashesByTeacher[id] || []).length,
      homeCommitmentsByDay: teacher.homeByDay,
      localCampusCollisions: clashesByTeacher[id] || [],
    };
  }).sort(function (a, b) { return a.teacherName.localeCompare(b.teacherName) || a.teacherId.localeCompare(b.teacherId); });

  const d = model.diagnostics;
  return {
    weekNo: week.weekNo,
    startDate: week.startDate,
    endDate: week.endDate,
    includeSaturday: Boolean(week.includeSaturday),
    raihanDates: dates,
    raihanPeriods: RAIHAN_PERIODS_.map(formatPeriod_),
    travelGapMinutes: TRAVEL_GAP_MINUTES_,
    teachers: teacherList,
    sourceRows: sessions.length,
    validDateRows: d.validDateRows,
    earliestValidDate: d.earliestValidDate,
    latestValidDate: d.latestValidDate,
    validDateSamples: d.validDateSamples,
    rowsInDateRange: d.rowsInDateRange,
    allocatedRows: allocated.length,
    duplicateRowsSkipped: d.duplicateRowsSkipped,
    skippedRows: d.skippedRows,
    invalidDateSamples: d.invalidDateSamples,
    invalidScheduleSamples: d.invalidScheduleSamples,
    raihanPlaced: placed.length,
    departmentStaffed: placed.filter(function (session) { return !session.primary; }).length,
    teacherDayCount: teacherList.reduce(function (sum, teacher) { return sum + teacher.raihanDays.length; }, 0),
    capacityPerClass: solve.capacityPerClass,
    demandByClass: solve.demandByClass,
    solver: { iterations: solve.iterations, elapsedMs: solve.elapsedMs, cost: solve.cost },
    lagCount: lags.length,
    lags: lags,
    lagBySubject: lagBySubject,
    notHeld: notHeld,
    notHeldCount: notHeld.length,
    localCampusCollisions: clashes,
    localCampusCollisionCount: clashes.length,
    campusSwapSuggestions: swaps,
    alteredDays: [],
    alteredDayCount: 0,
  };
}

function parseTeacherAssignments_(value) {
  const text = String(value || '');
  const result = [];
  const matcher = /\b(\d{8}|\d{4})\b/g;
  let match;
  while ((match = matcher.exec(text)) !== null) {
    const nameStart = matcher.lastIndex;
    const nextMatch = text.slice(nameStart).search(/\b(?:\d{8}|\d{4})\b/);
    const nameEnd = nextMatch < 0 ? text.length : nameStart + nextMatch;
    const name = text.slice(nameStart, nameEnd).split(/[,;/|]/)[0]
      .replace(/^[\s:+-]+|[\s:+-]+$/g, '').trim();
    result.push({
      id: match[1],
      name: name || match[1],
      isMusanid: match[1].indexOf('78652') === 0,
    });
  }
  return result;
}

function formatTeacherAssignments_(assignments) {
  return assignments.slice().sort(function (a, b) {
    return Number(a.isMusanid) - Number(b.isMusanid);
  }).map(function (assignment) {
    return (assignment.isMusanid ? 'MUSANID ' : '') + assignment.id + ' ' + assignment.name;
  }).join(' / ');
}

function formatPeriod_(value) {
  const period = normalizePeriod_(value);
  return period ? 'Period ' + period.slice(1) : '';
}

function normalizeSubjectKey_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[ʿʻ']/g, '').replace(/[^a-z0-9]/g, '');
}

function isRaihanSubject_(value) {
  const key = normalizeSubjectKey_(value);
  return RAIHAN_SUBJECTS_.some(function (subject) {
    return normalizeSubjectKey_(subject) === key;
  });
}

function addIsoDays_(isoDate, count) {
  const date = new Date(isoDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function writeWeekOutput_(weekNo, sourceHeaders, columns, sessions) {
  const headers = ['Week_No'].concat(sourceHeaders);
  const sheet = getWeekOutputSheet_(sourceHeaders);
  const retained = [];
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
      if (Number(row[0]) !== weekNo) retained.push(row);
    });
  }
  const output = sessions.map(function (session) {
    const row = session.row.slice();
    row[columns.date] = isoToSheetDate_(session.assignedDate);
    row[columns.period] = formatPeriod_(session.assignedPeriod);
    return [weekNo].concat(row);
  });
  replaceManagedRows_(sheet, headers, retained.concat(output));
}

function getWeekOutputSheet_(sourceHeaders) {
  const name = 'Raihan_Allocations';
  const expectedHeaders = ['Week_No'].concat(sourceHeaders);
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) return getOrCreateManagedSheet_(name, expectedHeaders);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value).trim().toLowerCase(); });
  const rawHeaders = sourceHeaders.map(function (value) { return value.toLowerCase(); });
  if (actualHeaders.length === rawHeaders.length &&
      rawHeaders.every(function (header, index) { return actualHeaders[index] === header; })) {
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue('Week_No');
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (actualHeaders.length !== expectedHeaders.length || expectedHeaders.some(function (header, index) {
    return actualHeaders[index] !== header.toLowerCase();
  })) throw apiError_('SHEET_SCHEMA_MISCONFIGURED');
  return sheet;
}

function writeSolverWorking_(weekNo, sessions, dateColumn, periodColumn) {
  const headers = [
    'Week_No', 'Status', 'Diagnostic', 'Source_Date', 'Source_Period', 'Class', 'Subject',
    'Teacher_ID', 'Teacher_Name', 'Assigned_Date', 'Assigned_Period', 'Musanid_JSON', 'Source_Row_JSON',
  ];
  const sheet = getOrCreateManagedSheet_('Raihan_Solver_Working', headers);
  const retained = [];
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues().forEach(function (row) {
      if (Number(row[0]) !== weekNo) retained.push(row);
    });
  }
  const rows = sessions.map(function (session) {
    const primary = session.primary || {};
    const sourceRow = session.row.slice();
    sourceRow[dateColumn] = session.date;
    sourceRow[periodColumn] = formatPeriod_(session.period);
    return [
      weekNo, session.status, session.diagnostic, session.date, formatPeriod_(session.period), session.className,
      session.subject, primary.id || '', primary.name || '', session.assignedDate,
      formatPeriod_(session.assignedPeriod), JSON.stringify(session.musanids), JSON.stringify(sourceRow),
    ];
  });
  replaceManagedRows_(sheet, headers, retained.concat(rows));
}

function replaceManagedRows_(sheet, headers, rows) {
  const oldLastRow = sheet.getLastRow();
  const output = [headers].concat(rows);
  sheet.getRange(1, 1, output.length, headers.length).setValues(output);
  if (oldLastRow > output.length) {
    sheet.getRange(output.length + 1, 1, oldLastRow - output.length, headers.length).clearContent();
  }
  sheet.setFrozenRows(1);
}

function getTemporaryTeacherSheet_() {
  return getOrCreateManagedSheet_(RAIHAN_TEMP_TEACHERS_SHEET_, [
    'Temp_ID', 'Name', 'Phone', 'Subjects_JSON', 'Availability_JSON', 'Updated_At', 'Updated_By',
  ]);
}

function getTemporaryTeachers_() {
  const sheet = getTemporaryTeacherSheet_();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues().map(function (row) {
    let subjects;
    let availability;
    try {
      subjects = JSON.parse(String(row[3] || '[]'));
      availability = JSON.parse(String(row[4] || '{}'));
    } catch (error) {
      throw apiError_('TEMP_TEACHER_DATA_MISCONFIGURED');
    }
    if (!Array.isArray(subjects) ||
        subjects.some(function (subject) { return typeof subject !== 'string' || !subject.trim(); }) ||
        !availability ||
        typeof availability !== 'object') {
      throw apiError_('TEMP_TEACHER_DATA_MISCONFIGURED');
    }
    return {
      id: String(row[0] || '').trim(),
      name: String(row[1] || '').trim(),
      phone: String(row[2] || ''),
      subjects: subjects,
      availability: WEEKDAYS_.reduce(function (normalized, day) {
        const periods = Array.isArray(availability[day]) ? availability[day] : [];
        normalized[day] = periods.map(normalizePeriod_).filter(function (period) {
          return RAIHAN_PERIODS_.indexOf(period) >= 0;
        });
        return normalized;
      }, {}),
    };
  });
}

function getTemporaryTeacherById_(teacherId) {
  const normalizedId = String(teacherId || '').trim().toUpperCase();
  return getTemporaryTeachers_().filter(function (teacher) {
    return teacher.id.toUpperCase() === normalizedId;
  })[0] || null;
}

function validateTemporaryTeacher_(payload) {
  const name = String(payload.name || '').trim();
  const phone = String(payload.phone || '').trim();
  const id = payload.id
    ? String(payload.id).trim()
    : 'TEMP_' + Utilities.getUuid();
  const subjects = Array.isArray(payload.subjects)
    ? payload.subjects.map(function (value) { return String(value || '').trim(); }).filter(Boolean)
    : [];
  const availability = payload.availability;
  if (!name) throw apiError_('TEMP_TEACHER_NAME_REQUIRED');
  if (!/^TEMP_[A-Za-z0-9-]+$/.test(id)) throw apiError_('TEMP_TEACHER_ID_INVALID');
  if (!subjects.length) throw apiError_('TEMP_TEACHER_SUBJECT_REQUIRED');
  if (!availability || typeof availability !== 'object' || Array.isArray(availability)) {
    throw apiError_('TEMP_TEACHER_AVAILABILITY_REQUIRED');
  }
  const normalizedAvailability = {};
  WEEKDAYS_.forEach(function (day) {
    const periods = Array.isArray(availability[day]) ? availability[day] : [];
    normalizedAvailability[day] = periods.map(normalizePeriod_).filter(function (period) {
      return RAIHAN_PERIODS_.indexOf(period) >= 0;
    }).map(formatPeriod_);
  });
  if (!WEEKDAYS_.some(function (day) { return normalizedAvailability[day].length > 0; })) {
    throw apiError_('TEMP_TEACHER_PERIOD_REQUIRED');
  }
  return {
    id: id,
    name: name,
    phone: phone,
    subjects: subjects,
    availability: normalizedAvailability,
  };
}

function assignTemporaryTeachers_(week) {
  const working = getOrCreateManagedSheet_('Raihan_Solver_Working', [
    'Week_No', 'Status', 'Diagnostic', 'Source_Date', 'Source_Period', 'Class', 'Subject',
    'Teacher_ID', 'Teacher_Name', 'Assigned_Date', 'Assigned_Period', 'Musanid_JSON', 'Source_Row_JSON',
  ]);
  const allocation = SpreadsheetApp.getActive().getSheetByName('Raihan_Allocations');
  if (!allocation || allocation.getLastRow() < 1) throw apiError_('SCHEDULE_NOT_GENERATED');
  const outputHeaders = allocation.getRange(1, 1, 1, allocation.getLastColumn()).getValues()[0];
  const outputColumns = outputHeaders.map(function (value) { return String(value).toLowerCase(); });
  const sourceColumns = outputColumns.map(function (value, index) { return index === 0 ? -1 : index - 1; });
  const dateColumn = outputColumns.indexOf('date');
  const periodColumn = outputColumns.indexOf('period');
  const classColumn = outputColumns.indexOf('class');
  const teacherColumn = outputColumns.indexOf('mufawwaz/department');
  const subjectColumn = outputColumns.indexOf('subject');
  if ([dateColumn, periodColumn, classColumn, teacherColumn, subjectColumn].some(function (index) { return index < 0; })) {
    throw apiError_('SHEET_SCHEMA_MISCONFIGURED');
  }

  const workingRows = working.getLastRow() < 2
    ? []
    : working.getRange(2, 1, working.getLastRow() - 1, 13).getValues();
  const lags = workingRows.map(function (row, index) {
    return { row: row, rowIndex: index + 2 };
  }).filter(function (entry) {
    return Number(entry.row[0]) === week.weekNo && entry.row[1] === 'LAG';
  });
  const teachers = getTemporaryTeachers_();
  const outputRows = allocation.getLastRow() < 2
    ? []
    : allocation.getRange(2, 1, allocation.getLastRow() - 1, outputHeaders.length).getValues();
  const weekRows = outputRows.filter(function (row) { return Number(row[0]) === week.weekNo; });
  const usedClasses = {};
  const usedTempTeachers = {};
  weekRows.forEach(function (row) {
    const date = rawDateToIso_(row[dateColumn]);
    const period = normalizePeriod_(row[periodColumn]);
    const className = String(row[classColumn] || '');
    const slot = date + '|' + period;
    if (!usedClasses[slot]) usedClasses[slot] = {};
    usedClasses[slot][className] = true;
    const temporaryIds = String(row[teacherColumn] || '').match(/TEMP_[A-Za-z0-9-]+/g) || [];
    temporaryIds.forEach(function (teacherId) {
      if (!usedTempTeachers[slot]) usedTempTeachers[slot] = {};
      usedTempTeachers[slot][teacherId] = true;
    });
  });

  let assigned = 0;
  const remaining = [];
  const newAllocationRows = [];
  lags.forEach(function (entry) {
    const row = entry.row;
    let sourceRow;
    try {
      sourceRow = JSON.parse(String(row[12] || '[]'));
    } catch (error) {
      throw apiError_('SOLVER_DATA_MISCONFIGURED');
    }
    const subject = String(row[6] || '');
    const className = String(row[5] || '');
    let completed = false;
    for (let teacherIndex = 0; teacherIndex < teachers.length && !completed; teacherIndex += 1) {
      const teacher = teachers[teacherIndex];
      if (!teacher.subjects.some(function (value) {
        if (typeof value !== 'string') throw apiError_('TEMP_TEACHER_DATA_MISCONFIGURED');
        return value === '*' || normalizeSubjectKey_(value) === normalizeSubjectKey_(subject);
      })) continue;
      const weekDates = raihanDates_(week);
      for (let dayIndex = 0; dayIndex < WEEKDAYS_.length && !completed; dayIndex += 1) {
        const day = WEEKDAYS_[dayIndex];
        const dates = weekDates.filter(function (item) { return item.day === day; })
          .map(function (item) { return item.date; });
        for (let dateIndex = 0; dateIndex < dates.length && !completed; dateIndex += 1) {
          const date = dates[dateIndex];
          const available = teacher.availability[day] || [];
          for (let periodIndex = 0; periodIndex < RAIHAN_PERIODS_.length; periodIndex += 1) {
            const period = RAIHAN_PERIODS_[periodIndex];
            const slot = date + '|' + period;
            if (available.indexOf(period) < 0 ||
                ((usedClasses[slot] || {})[className]) ||
                ((usedTempTeachers[slot] || {})[teacher.id])) continue;
            sourceRow[sourceColumns[dateColumn]] = isoToSheetDate_(date);
            sourceRow[sourceColumns[periodColumn]] = formatPeriod_(period);
            sourceRow[sourceColumns[teacherColumn]] = teacher.id + ' ' + teacher.name;
            newAllocationRows.push([week.weekNo].concat(sourceRow.slice()));
            if (!usedClasses[slot]) usedClasses[slot] = {};
            if (!usedTempTeachers[slot]) usedTempTeachers[slot] = {};
            usedClasses[slot][className] = true;
            usedTempTeachers[slot][teacher.id] = true;
            working.getRange(entry.rowIndex, 2, 1, 10).setValues([[
              'TEMP_ASSIGNED', '', row[3], formatPeriod_(row[4]), className, subject,
              teacher.id, teacher.name, date, formatPeriod_(period),
            ]]);
            assigned += 1;
            completed = true;
            break;
          }
        }
      }
    }
    if (!completed) remaining.push({
      className: className,
      subject: subject,
      diagnostic: row[2],
      date: row[3],
      period: row[4],
    });
  });
  if (newAllocationRows.length) {
    allocation.getRange(allocation.getLastRow() + 1, 1, newAllocationRows.length, outputHeaders.length)
      .setValues(newAllocationRows);
  }
  return { weekNo: week.weekNo, assigned: assigned, lags: remaining };
}

function getFinalRaihanWeek_(week) {
  const working = getOrCreateManagedSheet_('Raihan_Solver_Working', [
    'Week_No', 'Status', 'Diagnostic', 'Source_Date', 'Source_Period', 'Class', 'Subject',
    'Teacher_ID', 'Teacher_Name', 'Assigned_Date', 'Assigned_Period', 'Musanid_JSON', 'Source_Row_JSON',
  ]);
  const rows = working.getLastRow() < 2
    ? []
    : working.getRange(2, 1, working.getLastRow() - 1, 13).getValues();
  const teachers = {};
  const sessions = [];
  const pending = [];
  const campusSessions = [];
  const dates = raihanDates_(week);
  const allocation = SpreadsheetApp.getActive().getSheetByName('Raihan_Allocations');
  if (!allocation || allocation.getLastRow() < 2) throw apiError_('SCHEDULE_NOT_GENERATED');
  const outputHeaders = allocation.getRange(1, 1, 1, allocation.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value).trim().toLowerCase(); });
  const dateColumn = outputHeaders.indexOf('date');
  const periodColumn = outputHeaders.indexOf('period');
  const classColumn = outputHeaders.indexOf('class');
  const teacherColumn = outputHeaders.indexOf('mufawwaz/department');
  if ([dateColumn, periodColumn, classColumn, teacherColumn].some(function (index) { return index < 0; })) {
    throw apiError_('SHEET_SCHEMA_MISCONFIGURED');
  }
  const allocationRows = allocation.getRange(2, 1, allocation.getLastRow() - 1, outputHeaders.length).getValues();
  const occupied = allocationRows.filter(function (row) {
    return Number(row[0]) === week.weekNo;
  }).map(function (row) {
    return {
      date: rawDateToIso_(row[dateColumn]),
      period: normalizePeriod_(row[periodColumn]),
      className: String(row[classColumn] || ''),
      teacherIds: parseTeacherAssignments_(row[teacherColumn]).map(function (teacher) { return teacher.id; })
        .concat(String(row[teacherColumn] || '').match(/TEMP_[A-Za-z0-9-]+/g) || []),
    };
  }).filter(function (slot) { return slot.date && slot.period; });

  rows.forEach(function (row, index) {
    if (Number(row[0]) !== week.weekNo) return;
    const status = String(row[1] || '');
    const teacherId = String(row[7] || '');
    const teacherName = String(row[8] || '');
    const assignedDate = rawDateToIso_(row[9]);
    const period = normalizePeriod_(row[10]);
    const className = String(row[5] || '');
    const subject = String(row[6] || '');
    if (['RAIHAN', 'TEMP_ASSIGNED', 'MANUAL_ASSIGNED'].indexOf(status) >= 0 && teacherId) {
      if (!teachers[teacherId]) {
        teachers[teacherId] = {
          teacherId: teacherId,
          teacherName: teacherName,
          date: assignedDate,
          day: rawDateToWeekday_(assignedDate),
          dates: [],
          days: [],
          temporary: false,
          subjects: [],
        };
      }
      if (assignedDate && teachers[teacherId].dates.indexOf(assignedDate) < 0) {
        teachers[teacherId].dates.push(assignedDate);
        teachers[teacherId].days.push(rawDateToWeekday_(assignedDate));
      }
      if (teachers[teacherId].subjects.indexOf(subject) < 0) teachers[teacherId].subjects.push(subject);
    }
    if (['RAIHAN', 'TEMP_ASSIGNED', 'MANUAL_ASSIGNED'].indexOf(status) >= 0 &&
        assignedDate && period) {
      sessions.push({
        rowNumber: index + 2,
        status: status,
        date: assignedDate,
        day: rawDateToWeekday_(assignedDate),
        period: formatPeriod_(period),
        className: className,
        subject: subject,
        teacherId: teacherId,
        teacherName: teacherName,
      });
    }
    if (status === 'LAG' && week.classes.indexOf(className) >= 0) {
      pending.push({
        rowNumber: index + 2,
        date: rawDateToIso_(row[3]),
        sourcePeriod: formatPeriod_(row[4]),
        className: className,
        subject: subject,
        teacherId: teacherId,
        teacherName: teacherName,
        diagnostic: String(row[2] || ''),
      });
    }
    if (['KEPT', 'MOVED', 'CAMPUS_MANUAL'].indexOf(status) >= 0 && week.classes.indexOf(className) < 0) {
      const sourceDate = rawDateToIso_(row[3]);
      const sourcePeriod = normalizePeriod_(row[4]);
      if (sourceDate && sourcePeriod) {
        campusSessions.push({
          rowNumber: index + 2,
          date: assignedDate || sourceDate,
          day: rawDateToWeekday_(assignedDate || sourceDate),
          period: formatPeriod_(period || sourcePeriod),
          sourceDate: sourceDate,
          sourcePeriod: formatPeriod_(sourcePeriod),
          className: className,
          subject: subject,
          teacherId: teacherId,
          teacherName: teacherName,
          status: status,
          hasCollision: false,
        });
      }
    }
  });

  const campusBySlot = {};
  campusSessions.forEach(function (session) {
    const key = session.date + '|' + session.period;
    if (!campusBySlot[key]) campusBySlot[key] = [];
    campusBySlot[key].push(session);
  });
  Object.keys(campusBySlot).forEach(function (key) {
    const slotSessions = campusBySlot[key];
    for (let i = 0; i < slotSessions.length; i += 1) {
      for (let j = i + 1; j < slotSessions.length; j += 1) {
        const left = slotSessions[i];
        const right = slotSessions[j];
        if (left.className === right.className ||
            (left.teacherId && left.teacherId === right.teacherId)) {
          left.hasCollision = true;
          right.hasCollision = true;
        }
      }
    }
  });

  // Travel-gap warnings: a teacher's campus lesson too close to their Raihan lesson that day.
  const travelWarnings = [];
  const campusByTeacherDate = {};
  campusSessions.forEach(function (session) {
    if (!session.teacherId) return;
    const key = session.teacherId + '|' + session.date;
    if (!campusByTeacherDate[key]) campusByTeacherDate[key] = [];
    campusByTeacherDate[key].push(session);
  });
  const warned = {};
  sessions.forEach(function (session) {
    (campusByTeacherDate[session.teacherId + '|' + session.date] || []).forEach(function (campusSession) {
      if (!periodsClash_(normalizePeriod_(session.period), normalizePeriod_(campusSession.period))) return;
      campusSession.hasCollision = true;
      // One warning per campus lesson, matching the Allocation page's clash count.
      if (warned[session.teacherId + '|' + campusSession.rowNumber]) return;
      warned[session.teacherId + '|' + campusSession.rowNumber] = true;
      travelWarnings.push({
        teacherId: session.teacherId,
        teacherName: session.teacherName,
        date: session.date,
        raihanPeriod: session.period,
        raihanClass: session.className,
        campusPeriod: campusSession.period,
        campusClass: campusSession.className,
        campusSubject: campusSession.subject,
      });
    });
  });

  getTemporaryTeachers_().forEach(function (teacher) {
    const availableDays = dates.filter(function (day) {
      return (teacher.availability[day.day] || []).length > 0;
    });
    if (!availableDays.length) return;
    const assignedTeacher = teachers[teacher.id];
    teachers[teacher.id] = {
      teacherId: teacher.id,
      teacherName: teacher.name,
      date: assignedTeacher ? assignedTeacher.date : '',
      day: assignedTeacher ? assignedTeacher.day : '',
      dates: assignedTeacher ? assignedTeacher.dates : [],
      days: assignedTeacher ? assignedTeacher.days : [],
      temporary: true,
      availability: teacher.availability,
      availableDays: availableDays,
      subjects: teacher.subjects,
    };
  });

  return {
    weekNo: week.weekNo,
    startDate: week.startDate,
    endDate: week.endDate,
    classes: week.classes,
    dates: dates,
    raihanSubjects: RAIHAN_SUBJECTS_,
    raihanPeriods: RAIHAN_PERIODS_.map(formatPeriod_),
    includeSaturday: Boolean(week.includeSaturday),
    travelGapMinutes: TRAVEL_GAP_MINUTES_,
    travelWarnings: travelWarnings,
    teachers: Object.keys(teachers).map(function (id) { return teachers[id]; })
      .filter(function (teacher) { return teacher.teacherId && (teacher.temporary || teacher.date); })
      .sort(function (a, b) {
        return WEEKDAYS_.indexOf(a.day) - WEEKDAYS_.indexOf(b.day) ||
          a.teacherName.localeCompare(b.teacherName) ||
          a.teacherId.localeCompare(b.teacherId);
      }),
    sessions: sessions,
    pending: pending,
    pendingCount: pending.length,
    campusSessions: campusSessions,
    occupied: occupied,
  };
}

function rawDateToIso_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof value === 'number') {
    if (!isFinite(value) || value < 1 || value > 2958465) return '';
    const serialDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return serialDate.toISOString().slice(0, 10);
  }

  const text = String(value || '').trim();
  if (!text) return '';
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  if (isoMatch) return isValidIsoDate_(isoMatch[1]) ? isoMatch[1] : '';

  const numericMatch = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s.*)?$/);
  if (numericMatch) {
    const first = Number(numericMatch[1]);
    const second = Number(numericMatch[2]);
    const year = Number(numericMatch[3]);
    const locale = SpreadsheetApp.getActive().getSpreadsheetLocale().toLowerCase();
    const monthFirst = first <= 12 && (second > 12 || /^en_us(?:$|_)/.test(locale));
    const month = monthFirst ? first : second;
    const day = monthFirst ? second : first;
    const normalized = [
      String(year).padStart(4, '0'),
      String(month).padStart(2, '0'),
      String(day).padStart(2, '0'),
    ].join('-');
    return isValidIsoDate_(normalized) ? normalized : '';
  }

  const numericSerial = Number(text);
  if (Number.isFinite(numericSerial) && numericSerial >= 1 && numericSerial <= 2958465) {
    const serialDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(numericSerial) * 86400000);
    return serialDate.toISOString().slice(0, 10);
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? '' : Utilities.formatDate(
    parsed,
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(),
    'yyyy-MM-dd'
  );
}

function rawDateToWeekday_(isoDate) {
  const date = new Date(isoDate + 'T00:00:00Z');
  return WEEKDAYS_[(date.getUTCDay() + 6) % 7] || '';
}

function normalizePeriod_(value) {
  const text = String(value || '').trim();
  if (/^\(\s*PT\s*\)$/i.test(text)) return 'P1';
  const match = text.match(/^(?:P|PERIOD)?\s*(\d+)$/i);
  const number = match ? Number(match[1]) : 0;
  return number >= 1 && number <= SOURCE_PERIODS_PER_DAY_ ? 'P' + number : '';
}

/* ---- authentication -------------------------------------------------------------------- */

/** Confirms the Google ID token is genuine, unexpired, and issued for this app. */
function verifyIdToken_(idToken) {
  if (!idToken) throw apiError_('INVALID_TOKEN');

  const cache = CacheService.getScriptCache();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken);
  const cacheKey = 'idt_' + Utilities.base64EncodeWebSafe(digest);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) throw apiError_('INVALID_TOKEN');

  const info = JSON.parse(response.getContentText());
  if (info.aud !== CONFIG.GOOGLE_CLIENT_ID) throw apiError_('AUDIENCE_MISMATCH');
  if (String(info.email_verified) !== 'true') throw apiError_('INVALID_TOKEN');

  const identity = {
    email: String(info.email).toLowerCase(),
    name: info.name || '',
    picture: info.picture || '',
  };

  const secondsLeft = Number(info.exp) - Math.floor(Date.now() / 1000);
  const ttl = Math.min(300, secondsLeft);
  if (ttl > 0) cache.put(cacheKey, JSON.stringify(identity), ttl);

  return identity;
}

/* ---- users / roles --------------------------------------------------------------------- */

/** Looks the verified email up in the Users sheet and returns the profile sent to the app. */
function loadUser_(identity) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.USERS_SHEET);
  if (!sheet) throw apiError_('SERVER_MISCONFIGURED');

  const rows = sheet.getDataRange().getValues();
  const header = rows.shift().map(function (h) { return String(h).trim().toLowerCase(); });
  const col = function (name) { return header.indexOf(name); };
  const cell = function (row, name) {
    const index = col(name);
    return index === -1 || row[index] === null || row[index] === undefined ? '' : String(row[index]).trim();
  };

  const row = rows.find(function (r) { return cell(r, 'email').toLowerCase() === identity.email; });
  if (!row) throw apiError_('NOT_AUTHORIZED');

  if (['FALSE', 'NO', '0'].indexOf(cell(row, 'active').toUpperCase()) !== -1) {
    throw apiError_('ACCOUNT_INACTIVE');
  }

  const role = cell(row, 'role').toLowerCase();
  if (CONFIG.VALID_ROLES.indexOf(role) === -1) throw apiError_('INVALID_ROLE');

  const assignedClass = cell(row, 'assigned_class');
  if (role === 'monitor' && !assignedClass) throw apiError_('MISCONFIGURED_ACCOUNT');

  return {
    email: identity.email,
    name: cell(row, 'name') || identity.name,
    picture: identity.picture,
    role: role,
    assignedClass: assignedClass,
    teacherId: cell(row, 'teacher_id'),
  };
}

/* ---- helpers --------------------------------------------------------------------------- */

function apiError_(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}