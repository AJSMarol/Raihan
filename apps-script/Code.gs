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
const PERIODS_PER_DAY_ = 8;

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
    });
    return advisory;
  } finally {
    lock.releaseLock();
  }
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
  return { weekNo: weekNo, startDate: startDate, endDate: endDate, classes: classes };
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
  return getOrCreateManagedSheet_(RAIHAN_WEEKS_SHEET_, [
    'Week_No',
    'Start_Date',
    'End_Date',
    'Classes_JSON',
    'Status',
    'Updated_At',
    'Updated_By',
  ]);
}

function getWeekRecord_(weekNo) {
  const sheet = getWeekSheet_();
  if (!sheet || sheet.getLastRow() < 2) return null;
  const rowIndex = findWeekRow_(sheet, weekNo);
  if (!rowIndex) return null;
  const row = sheet.getRange(rowIndex, 1, 1, 7).getValues()[0];
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

function generateWeekSchedule_(week) {
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

  const selected = {};
  week.classes.forEach(function (className) { selected[className] = true; });
  const skippedRows = {
    invalidDate: 0,
    invalidWeekday: 0,
    invalidClass: 0,
    invalidPeriod: 0,
    invalidSubject: 0,
    invalidTeacher: 0,
  };
  const bySlot = {};
  const invalidDateSamples = [];
  const validDateSamples = [];
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
      validDateSamples.push({
        row: rowIndex + 2,
        parsedDate: date,
        displayedValue: String(displayedDate || '').slice(0, 80),
      });
    }
    if (date < week.startDate || date > week.endDate) return;
    rowsInDateRange += 1;
    const className = String(sourceRow[columns.className] || '').trim();
    const period = normalizePeriod_(sourceRow[columns.period]);
    const subject = String(sourceRow[columns.subject] || '').trim();
    const assignments = parseTeacherAssignments_(sourceRow[columns.teacher]);
    if (!className) skippedRows.invalidClass += 1;
    if (!period) skippedRows.invalidPeriod += 1;
    if (!subject) skippedRows.invalidSubject += 1;
    if (!assignments.length) skippedRows.invalidTeacher += 1;
    if (!className || !period || !subject || !assignments.length) return;
    const day = rawDateToWeekday_(date);
    if (WEEKDAYS_.indexOf(day) < 0) {
      skippedRows.invalidWeekday += 1;
      return;
    }

    const key = [date, period, className, subject].join('|');
    if (bySlot[key]) {
      const session = bySlot[key];
      duplicateRowsSkipped += 1;
      assignments.forEach(function (assignment) {
        if (!session.assignments.some(function (saved) { return saved.id === assignment.id; })) {
          session.assignments.push(assignment);
        }
        if (assignment.isMusanid &&
            !session.musanids.some(function (saved) { return saved.id === assignment.id; })) {
          session.musanids.push(assignment);
        }
      });
      if (!session.primary) {
        session.primary = session.assignments.filter(function (item) { return !item.isMusanid; })[0] || null;
      }
      session.assignments.sort(function (a, b) { return Number(a.isMusanid) - Number(b.isMusanid); });
      session.row[columns.teacher] = formatTeacherAssignments_(session.assignments);
      return;
    }
    const row = sourceRow.slice();
    row[columns.date] = date;
    row[columns.period] = period;
    row[columns.className] = className;
    row[columns.subject] = subject;
    row[columns.teacher] = formatTeacherAssignments_(assignments);
    bySlot[key] = {
      key: key,
      row: row,
      date: date,
      day: day,
      period: period,
      className: className,
      subject: subject,
      selected: Boolean(selected[className]),
      assignments: assignments,
      primary: assignments.filter(function (item) { return !item.isMusanid; })[0] || null,
      musanids: assignments.filter(function (item) { return item.isMusanid; }),
      status: 'SOURCE',
      diagnostic: '',
      assignedDate: date,
      assignedPeriod: period,
    };
  });

  const sessions = Object.keys(bySlot).map(function (key) { return bySlot[key]; });
  const datesByDay = {};
  WEEKDAYS_.forEach(function (day) { datesByDay[day] = []; });
  for (let date = week.startDate; date <= week.endDate; date = addIsoDays_(date, 1)) {
    const day = rawDateToWeekday_(date);
    if (datesByDay[day]) datesByDay[day].push(date);
  }

  const teachers = {};
  sessions.forEach(function (session) {
    session.assignments.forEach(function (assignment) {
      if (assignment.isMusanid) return;
      if (!teachers[assignment.id]) {
        teachers[assignment.id] = {
          id: assignment.id,
          name: assignment.name,
          classes: {},
          homeByDay: {},
          homeSessions: [],
          raihanSessions: 0,
        };
        WEEKDAYS_.forEach(function (day) { teachers[assignment.id].homeByDay[day] = 0; });
      }
      const teacher = teachers[assignment.id];
      if (session.selected) {
        teacher.classes[session.className] = true;
        teacher.raihanSessions += 1;
      } else {
        teacher.homeByDay[session.day] += 1;
        teacher.homeSessions.push(session);
      }
    });
  });

  const teacherResults = {};
  Object.keys(teachers).sort().forEach(function (id) {
    const teacher = teachers[id];
    if (!teacher.raihanSessions) return;
    const days = WEEKDAYS_.filter(function (day) { return datesByDay[day].length; });
    teacher.raihanDay = days.sort(function (a, b) {
      return teacher.homeByDay[a] - teacher.homeByDay[b] || WEEKDAYS_.indexOf(a) - WEEKDAYS_.indexOf(b);
    })[0] || '';
    teacher.displaced = teacher.homeSessions.filter(function (session) {
      return session.day === teacher.raihanDay;
    });
    teacher.displaced.forEach(function (session) { session.status = 'TO_MOVE'; });
    teacherResults[id] = teacher;
  });

  const occupiedTeacher = {};
  const occupiedClass = {};
  const slotKey = function (date, period) { return date + '|' + period; };
  const mark = function (session, date, period) {
    const key = slotKey(date, period);
    if (!occupiedTeacher[key]) occupiedTeacher[key] = {};
    if (!occupiedClass[key]) occupiedClass[key] = {};
    if (session.primary) occupiedTeacher[key][session.primary.id] = true;
    occupiedClass[key][session.className] = true;
  };
  const free = function (session, date, period) {
    const key = slotKey(date, period);
    return (!session.primary || !(occupiedTeacher[key] || {})[session.primary.id]) &&
      !(occupiedClass[key] || {})[session.className];
  };
  sessions.forEach(function (session) {
    if (session.selected || session.status === 'TO_MOVE' || session.status === 'LAG') return;
    mark(session, session.date, session.period);
    session.status = 'KEPT';
  });

  const subjectCounts = {};
  sessions.forEach(function (session) {
    subjectCounts[session.subject] = (subjectCounts[session.subject] || 0) + 1;
  });
  const periodOrder = ['P2', 'P4', 'P6', 'P1', 'P3', 'P5', 'P7', 'P8'];
  const byRarerSubject = function (a, b) {
    return subjectCounts[a.subject] - subjectCounts[b.subject] ||
      a.subject.localeCompare(b.subject) || a.className.localeCompare(b.className);
  };
  const fixedCandidates = sessions.filter(function (session) {
    return !session.selected && session.status !== 'TO_MOVE';
  });
  const fixedBySlot = {};
  fixedCandidates.forEach(function (session) {
    const key = slotKey(session.date, session.period);
    if (!fixedBySlot[key]) fixedBySlot[key] = [];
    fixedBySlot[key].push(session);
  });
  Object.keys(fixedBySlot).forEach(function (key) {
    const slotSessions = fixedBySlot[key];
    for (let i = 0; i < slotSessions.length; i += 1) {
      for (let j = i + 1; j < slotSessions.length; j += 1) {
        const left = slotSessions[i];
        const right = slotSessions[j];
        const classCollision = left.className === right.className;
        const teacherCollision = left.primary && right.primary && left.primary.id === right.primary.id;
        if (classCollision || teacherCollision) {
          left.status = 'LAG';
          right.status = 'LAG';
          left.diagnostic = 'Period Collision';
          right.diagnostic = 'Period Collision';
        }
      }
    }
  });
  fixedCandidates.filter(function (session) { return session.status === 'LAG'; })
    .forEach(function (session) {
      if (!session.diagnostic) session.diagnostic = 'Period Collision';
    });
  sessions.filter(function (session) { return session.status === 'TO_MOVE'; })
    .sort(byRarerSubject).forEach(function (session) {
      for (let dayIndex = 0; dayIndex < WEEKDAYS_.length; dayIndex += 1) {
        const day = WEEKDAYS_[dayIndex];
        if (day === session.day) continue;
        for (let dateIndex = 0; dateIndex < datesByDay[day].length; dateIndex += 1) {
          const date = datesByDay[day][dateIndex];
          for (let i = 0; i < periodOrder.length; i += 1) {
            if (!free(session, date, periodOrder[i])) continue;
            session.assignedDate = date;
            session.assignedPeriod = periodOrder[i];
            session.status = 'MOVED';
            mark(session, date, periodOrder[i]);
            return;
          }
        }
      }
      session.status = 'LAG';
      session.diagnostic = 'Period Collision';
    });

  const raihanPeriodsByTeacher = {};
  sessions.filter(function (session) { return session.selected; })
    .sort(byRarerSubject).forEach(function (session) {
      const teacher = session.primary ? teacherResults[session.primary.id] : null;
      if (!teacher || !teacher.raihanDay || !datesByDay[teacher.raihanDay].length) {
        session.status = 'LAG';
        session.diagnostic = 'No Single-Day Availability';
        return;
      }
      const assignedCount = raihanPeriodsByTeacher[teacher.id] || 0;
      if (assignedCount >= PERIODS_PER_DAY_) {
        session.status = 'LAG';
        session.diagnostic = 'Teacher Overbooked';
        return;
      }
      const date = datesByDay[teacher.raihanDay][0];
      for (let i = 0; i < periodOrder.length; i += 1) {
        if (!free(session, date, periodOrder[i])) continue;
        session.assignedDate = date;
        session.assignedPeriod = periodOrder[i];
        session.status = 'RAIHAN';
        raihanPeriodsByTeacher[teacher.id] = assignedCount + 1;
        mark(session, date, periodOrder[i]);
        return;
      }
      session.status = 'LAG';
      session.diagnostic = 'Period Collision';
    });

  const allocated = sessions.filter(function (session) {
    return ['KEPT', 'MOVED', 'RAIHAN'].indexOf(session.status) >= 0;
  });
  writeWeekOutput_(week.weekNo, sourceHeaders, columns, allocated);
  writeSolverWorking_(week.weekNo, sessions, columns.date);
  const lags = sessions.filter(function (session) { return session.status === 'LAG'; })
    .map(function (session) {
      return {
        className: session.className,
        subject: session.subject,
        teacherId: session.primary ? session.primary.id : '',
        teacherName: session.primary ? session.primary.name : '',
        date: session.date,
        period: session.period,
        diagnostic: session.diagnostic,
      };
    });
  const lagBySubject = {};
  lags.forEach(function (lag) { lagBySubject[lag.subject] = (lagBySubject[lag.subject] || 0) + 1; });
  const alteredDates = {};
  sessions.forEach(function (session) {
    if (session.status !== 'MOVED' && session.status !== 'RAIHAN') return;
    if (session.date !== session.assignedDate || session.period !== session.assignedPeriod) {
      alteredDates[session.date] = true;
      alteredDates[session.assignedDate] = true;
    }
  });
  const alteredDays = Object.keys(alteredDates).sort();
  return {
    weekNo: week.weekNo,
    startDate: week.startDate,
    endDate: week.endDate,
    teachers: Object.keys(teacherResults).sort().map(function (id) {
      const teacher = teacherResults[id];
      return {
        teacherId: teacher.id,
        teacherName: teacher.name,
        classes: Object.keys(teacher.classes).sort(),
        raihanSessions: teacher.raihanSessions,
        raihanDay: teacher.raihanDay,
        homeCommitmentsOnRaihanDay: teacher.displaced.length,
        unplacedHomeCommitments: teacher.displaced.filter(function (session) {
          return session.status === 'LAG';
        }).length,
        homeCommitmentsByDay: teacher.homeByDay,
      };
    }),
    sourceRows: sessions.length,
    validDateRows: validDateRows,
    earliestValidDate: earliestValidDate,
    latestValidDate: latestValidDate,
    validDateSamples: validDateSamples,
    rowsInDateRange: rowsInDateRange,
    allocatedRows: allocated.length,
    duplicateRowsSkipped: duplicateRowsSkipped,
    skippedRows: skippedRows,
    invalidDateSamples: invalidDateSamples,
    alteredDays: alteredDays,
    alteredDayCount: alteredDays.length,
    lagCount: lags.length,
    lags: lags,
    lagBySubject: lagBySubject,
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
    row[columns.period] = session.assignedPeriod;
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

function writeSolverWorking_(weekNo, sessions, dateColumn) {
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
    return [
      weekNo, session.status, session.diagnostic, session.date, session.period, session.className,
      session.subject, primary.id || '', primary.name || '', session.assignedDate,
      session.assignedPeriod, JSON.stringify(session.musanids), JSON.stringify(sourceRow),
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
      id: String(row[0]),
      name: String(row[1]),
      phone: String(row[2] || ''),
      subjects: subjects,
      availability: availability,
    };
  });
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
  if (!name || !/^TEMP_[A-Za-z0-9-]+$/.test(id) || !subjects.length ||
      !availability || typeof availability !== 'object') {
    throw apiError_('INVALID_PAYLOAD');
  }
  const normalizedAvailability = {};
  WEEKDAYS_.forEach(function (day) {
    const periods = Array.isArray(availability[day]) ? availability[day] : [];
    normalizedAvailability[day] = periods.map(normalizePeriod_).filter(Boolean);
  });
  if (!WEEKDAYS_.some(function (day) { return normalizedAvailability[day].length > 0; })) {
    throw apiError_('INVALID_PAYLOAD');
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
        return value.toLowerCase() === subject.toLowerCase() || value === '*';
      })) continue;
      for (let dayIndex = 0; dayIndex < WEEKDAYS_.length && !completed; dayIndex += 1) {
        const day = WEEKDAYS_[dayIndex];
        const dates = [];
        for (let date = week.startDate; date <= week.endDate; date = addIsoDays_(date, 1)) {
          if (rawDateToWeekday_(date) === day) dates.push(date);
        }
        for (let dateIndex = 0; dateIndex < dates.length && !completed; dateIndex += 1) {
          const date = dates[dateIndex];
          const available = teacher.availability[day] || [];
          for (let periodNumber = 1; periodNumber <= PERIODS_PER_DAY_; periodNumber += 1) {
            const period = 'P' + periodNumber;
            const slot = date + '|' + period;
            if (available.indexOf(period) < 0 ||
                ((usedClasses[slot] || {})[className]) ||
                ((usedTempTeachers[slot] || {})[teacher.id])) continue;
            sourceRow[sourceColumns[dateColumn]] = isoToSheetDate_(date);
            sourceRow[sourceColumns[periodColumn]] = period;
            sourceRow[sourceColumns[teacherColumn]] = teacher.id + ' ' + teacher.name;
            allocation.appendRow([week.weekNo].concat(sourceRow));
            if (!usedClasses[slot]) usedClasses[slot] = {};
            if (!usedTempTeachers[slot]) usedTempTeachers[slot] = {};
            usedClasses[slot][className] = true;
            usedTempTeachers[slot][teacher.id] = true;
            working.getRange(entry.rowIndex, 2, 1, 10).setValues([[
              'TEMP_ASSIGNED', '', row[3], row[4], className, subject, row[7], row[8], date, period,
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
  return { weekNo: week.weekNo, assigned: assigned, lags: remaining };
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
  const match = String(value || '').trim().match(/^P?\s*(\d+)$/i);
  const number = match ? Number(match[1]) : 0;
  return number >= 1 && number <= PERIODS_PER_DAY_ ? 'P' + number : '';
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
