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
};

const RAW_DATA_SHEET_ = 'JHS_Raw_Data';
const RAIHAN_WEEKS_SHEET_ = 'Raihan_Weeks';
const RAIHAN_WEEK_LOGS_SHEET_ = 'Raihan_Week_Logs';
const WEEKDAYS_ = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PERIODS_PER_DAY_ = 8;

function doGet() {
  return json_({ ok: true, data: { service: 'raihan-timetable-ai', version: 1 } });
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

  const advisory = analyzeWeek_(week);
  appendWeekLog_(weekNo, ctx.user.email, 'WEEK_ANALYZED', {
    teacherCount: advisory.teachers.length,
    sourceRows: advisory.sourceRows,
    duplicateRowsSkipped: advisory.duplicateRowsSkipped,
    skippedRows: advisory.skippedRows,
  });
  return advisory;
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

function analyzeWeek_(week) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RAW_DATA_SHEET_);
  if (!sheet) throw apiError_('RAW_DATA_MISSING');
  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    return {
      weekNo: week.weekNo,
      teachers: [],
      sourceRows: 0,
      duplicateRowsSkipped: 0,
      skippedRows: { invalidDate: 0, invalidWeekday: 0, invalidClass: 0, invalidPeriod: 0, invalidTeacher: 0 },
    };
  }

  const headers = values[0].map(function (value) {
    return String(value).trim().toLowerCase();
  });
  const column = {
    period: headers.indexOf('period'),
    className: headers.indexOf('class'),
    subject: headers.indexOf('subject'),
    teacher: headers.indexOf('mufawwaz/department'),
    date: headers.indexOf('date'),
  };
  if (Object.keys(column).some(function (key) { return column[key] === -1; })) {
    throw apiError_('RAW_DATA_MISCONFIGURED');
  }

  const selectedClasses = {};
  week.classes.forEach(function (className) { selectedClasses[className] = true; });
  const teachers = {};
  const classOccupiedByDay = {};
  WEEKDAYS_.forEach(function (day) { classOccupiedByDay[day] = {}; });
  const seen = {};
  let sourceRows = 0;
  let duplicateRowsSkipped = 0;
  const skippedRows = { invalidDate: 0, invalidWeekday: 0, invalidClass: 0, invalidPeriod: 0, invalidTeacher: 0 };
  values.slice(1).forEach(function (row) {
    const date = rawDateToIso_(row[column.date]);
    const hasData = row.some(function (value) { return String(value || '').trim() !== ''; });
    if (!date) {
      if (hasData) skippedRows.invalidDate += 1;
      return;
    }
    if (date < week.startDate || date > week.endDate) return;
    const className = String(row[column.className] || '').trim();
    const period = normalizePeriod_(row[column.period]);
    const teacherValue = String(row[column.teacher] || '').trim();
    const teacherMatch = teacherValue.match(/^\s*(\d{8}|\d{4})(?:\s+(.*?))?\s*$/);
    if (!className) skippedRows.invalidClass += 1;
    if (!period) skippedRows.invalidPeriod += 1;
    if (!teacherMatch) skippedRows.invalidTeacher += 1;
    if (!className || !period || !teacherMatch) return;

    const teacherId = teacherMatch[1];
    const teacherName = teacherMatch[2] || teacherId;
    const subject = String(row[column.subject] || '').trim();
    const day = rawDateToWeekday_(date);
    if (WEEKDAYS_.indexOf(day) === -1) {
      skippedRows.invalidWeekday += 1;
      return;
    }
    const key = [date, period, className, subject, teacherId].join('|');
    if (seen[key]) {
      duplicateRowsSkipped += 1;
      return;
    }
    seen[key] = true;
    sourceRows += 1;

    if (!teachers[teacherId]) {
      teachers[teacherId] = {
        teacherId: teacherId,
        teacherName: teacherName,
        assignedClasses: {},
        raihanSessions: 0,
        homeByDay: {},
        homeSessionsByDay: {},
        occupiedByDay: {},
      };
      WEEKDAYS_.forEach(function (weekday) {
        teachers[teacherId].homeByDay[weekday] = 0;
        teachers[teacherId].homeSessionsByDay[weekday] = [];
        teachers[teacherId].occupiedByDay[weekday] = {};
      });
    }

    const teacher = teachers[teacherId];
    teacher.teacherName = teacherName;
    if (selectedClasses[className]) {
      teacher.assignedClasses[className] = true;
      teacher.raihanSessions += 1;
    } else {
      teacher.homeByDay[day] += 1;
      teacher.occupiedByDay[day][period] = true;
      teacher.homeSessionsByDay[day].push({
        date: date,
        day: day,
        period: period,
        className: className,
        subject: subject,
      });
      if (!classOccupiedByDay[day][className]) classOccupiedByDay[day][className] = {};
      classOccupiedByDay[day][className][period] = true;
    }
  });

  const plannedTeacherSlots = {};
  const plannedClassSlots = {};
  WEEKDAYS_.forEach(function (day) { plannedClassSlots[day] = {}; });
  const result = Object.keys(teachers).sort().map(function (teacherId) {
    const teacher = teachers[teacherId];
    if (!Object.keys(teacher.assignedClasses).length) return null;
    const raihanDay = WEEKDAYS_.slice().sort(function (a, b) {
      return teacher.homeByDay[a] - teacher.homeByDay[b] ||
        WEEKDAYS_.indexOf(a) - WEEKDAYS_.indexOf(b);
    })[0];
    const displaced = teacher.homeByDay[raihanDay];
    const displacedSessions = teacher.homeSessionsByDay[raihanDay].slice().sort(function (a, b) {
      return Number(a.period.slice(1)) - Number(b.period.slice(1)) ||
        a.className.localeCompare(b.className) ||
        a.subject.localeCompare(b.subject);
    });
    if (!plannedTeacherSlots[teacherId]) {
      plannedTeacherSlots[teacherId] = {};
      WEEKDAYS_.forEach(function (day) { plannedTeacherSlots[teacherId][day] = {}; });
    }
    const suggestedMoves = [];
    displacedSessions.forEach(function (session) {
      for (let dayIndex = 0; dayIndex < WEEKDAYS_.length; dayIndex += 1) {
        const day = WEEKDAYS_[dayIndex];
        if (day === raihanDay) continue;
        for (let periodNumber = 1; periodNumber <= PERIODS_PER_DAY_; periodNumber += 1) {
          const period = 'P' + periodNumber;
          const classSlots = classOccupiedByDay[day][session.className] || {};
          const reservedClassSlots = plannedClassSlots[day][session.className] || {};
          if (teacher.occupiedByDay[day][period] ||
              plannedTeacherSlots[teacherId][day][period] ||
              classSlots[period] ||
              reservedClassSlots[period]) continue;
          plannedTeacherSlots[teacherId][day][period] = true;
          if (!plannedClassSlots[day][session.className]) plannedClassSlots[day][session.className] = {};
          plannedClassSlots[day][session.className][period] = true;
          suggestedMoves.push({
            from: session,
            to: { day: day, period: period },
          });
          return;
        }
      }
    });
    return {
      teacherId: teacher.teacherId,
      teacherName: teacher.teacherName,
      classes: Object.keys(teacher.assignedClasses).sort(),
      raihanSessions: teacher.raihanSessions,
      raihanSessionOverflow: Math.max(0, teacher.raihanSessions - PERIODS_PER_DAY_),
      raihanDay: raihanDay,
      homeCommitmentsOnRaihanDay: displaced,
      suggestedMoves: suggestedMoves,
      unplacedHomeCommitments: Math.max(0, displaced - suggestedMoves.length),
      homeCommitmentsByDay: teacher.homeByDay,
    };
  }).filter(function (teacher) { return teacher !== null; });

  return {
    weekNo: week.weekNo,
    startDate: week.startDate,
    endDate: week.endDate,
    teachers: result,
    sourceRows: sourceRows,
    duplicateRowsSkipped: duplicateRowsSkipped,
    skippedRows: skippedRows,
  };
}

function rawDateToIso_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
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
