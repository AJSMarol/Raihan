import { env } from '@/config/env';

const ERROR_MESSAGES = {
  NOT_AUTHORIZED:
    "This Google account isn't registered for Raihan Timetable AI. Ask an admin to add your email.",
  ACCOUNT_INACTIVE: 'This account has been deactivated. Contact an admin to restore access.',
  MISCONFIGURED_ACCOUNT: 'Your account has no class assigned yet. Contact an admin.',
  INVALID_ROLE: "Your account's role isn't recognised. Contact an admin.",
  INVALID_TOKEN: 'Google sign-in could not be verified. Sign in again.',
  TOKEN_EXPIRED: 'Google sign-in expired before it could be verified. Sign in again.',
  AUDIENCE_MISMATCH:
    'The Google client ID in the app and in Apps Script do not match. Check both settings.',
  FORBIDDEN: "Your role can't perform this action.",
  UNKNOWN_ACTION: 'The server does not recognise this request. The app and the Apps Script may be out of date.',
  SERVER_MISCONFIGURED: 'The Users sheet is missing from the spreadsheet. Check the Apps Script setup.',
  SERVER_ERROR: 'The server hit an error. Try again in a moment.',
  CONFIG_MISSING: 'The app API URL is not set. Check src/config/publicConfig.js.',
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
  BAD_RESPONSE: 'The server sent a response the app could not read. Check the Apps Script deployment.',
  UNKNOWN: 'Something went wrong. Try again.',
};

export class ApiError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN);
    this.name = 'ApiError';
    this.code = ERROR_MESSAGES[code] ? code : 'UNKNOWN';
  }
}

export const UNKNOWN_ERROR_MESSAGE = ERROR_MESSAGES.UNKNOWN;

/* ---- token + session-expiry wiring (set by AuthProvider) ------------------------------ */

let authToken = null;
let onAuthError = null;

export function setAuthToken(token) {
  authToken = token;
}

export function setAuthErrorHandler(handler) {
  onAuthError = handler;
}

/* ---- the one function every module uses to talk to Apps Script ----------------------- */

/**
 * POST { action, payload, idToken } to the Apps Script web app.
 * Resolves with `data` from { ok: true, data } and throws ApiError otherwise.
 *
 * Pass `idToken` explicitly only for the login call (before the token is stored).
 */
export async function apiCall(action, payload = {}, { idToken, signal } = {}) {
  if (!env.API_URL) throw new ApiError('CONFIG_MISSING');

  let response;
  try {
    response = await fetch(env.API_URL, {
      method: 'POST',
      // text/plain keeps this a CORS "simple request". Apps Script cannot answer the
      // preflight (OPTIONS) request that application/json would trigger.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload, idToken: idToken ?? authToken }),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('NETWORK');
  }

  if (!response.ok) throw new ApiError('NETWORK');

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('BAD_RESPONSE');
  }

  if (!body?.ok) {
    const error = new ApiError(body?.error);
    // An expired/invalid token on a normal call means the session is over.
    if (error.code === 'INVALID_TOKEN' && !idToken) onAuthError?.();
    throw error;
  }

  return body.data;
}
