/**
 * Raihan Timetable AI - Apps Script API (auth + role lookup)
 *
 * Setup: open the Google Sheet > Extensions > Apps Script, paste this file, set GOOGLE_CLIENT_ID,
 * then Deploy > New deployment > Web app:
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
  GOOGLE_CLIENT_ID: 'PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com',
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
};

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
