import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { googleLogout } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { isValidRole } from '@/config/roles';
import {
  ApiError,
  UNKNOWN_ERROR_MESSAGE,
  apiCall,
  setAuthErrorHandler,
  setAuthToken,
} from '@/services/api';
import { AuthContext } from './AuthContext';

const STORAGE_KEY = 'rtai.idToken';
const EXPIRY_SKEW_MS = 30_000;
const SESSION_EXPIRED = 'Your session expired. Sign in again to continue.';

/*
 * status:
 *   bootstrapping   - first load, deciding whether a stored token can be reused
 *   authenticating  - a token is being verified by the backend
 *   authenticated   - backend confirmed the email and returned a role
 *   unauthenticated - signed out (error holds the reason, if any)
 */
const initialState = { status: 'bootstrapping', user: null, idToken: null, error: null };

function reducer(state, action) {
  switch (action.type) {
    case 'SIGN_IN_START':
      return { ...state, status: 'authenticating', error: null };
    case 'SIGN_IN_SUCCESS':
      return { status: 'authenticated', user: action.user, idToken: action.idToken, error: null };
    case 'SIGNED_OUT':
      return { status: 'unauthenticated', user: null, idToken: null, error: action.error ?? null };
    default:
      return state;
  }
}

/* sessionStorage can throw (private mode, blocked storage) - treat that as "no stored token". */
const readStoredToken = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};
const storeToken = (token) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* ignore */
  }
};
const clearStoredToken = () => {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

function msUntilExpiry(jwt) {
  try {
    return jwtDecode(jwt).exp * 1000 - Date.now();
  } catch {
    return -1;
  }
}

function normaliseUser(profile) {
  if (!profile?.email || !isValidRole(profile.role)) throw new ApiError('INVALID_ROLE');
  return {
    email: profile.email,
    name: profile.name || profile.email,
    picture: profile.picture || null,
    role: profile.role,
    assignedClass: profile.assignedClass || null, // monitors: e.g. "4 A M"
    teacherId: profile.teacherId || null, // viewers (teachers)
  };
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const didBootstrap = useRef(false);

  const signOut = useCallback((reason) => {
    googleLogout();
    clearStoredToken();
    setAuthToken(null);
    dispatch({ type: 'SIGNED_OUT', error: typeof reason === 'string' ? reason : null });
  }, []);

  /** Takes the Google ID token (JWT), asks the backend who it belongs to, stores the result. */
  const signIn = useCallback(async (credential) => {
    dispatch({ type: 'SIGN_IN_START' });
    try {
      if (msUntilExpiry(credential) <= EXPIRY_SKEW_MS) throw new ApiError('TOKEN_EXPIRED');

      const profile = await apiCall('auth.login', {}, { idToken: credential });
      const user = normaliseUser(profile);

      storeToken(credential);
      setAuthToken(credential);
      dispatch({ type: 'SIGN_IN_SUCCESS', user, idToken: credential });
    } catch (error) {
      clearStoredToken();
      setAuthToken(null);
      dispatch({
        type: 'SIGNED_OUT',
        error: error instanceof ApiError ? error.message : UNKNOWN_ERROR_MESSAGE,
      });
    }
  }, []);

  // On first load, reuse a still-valid token from this browser tab. The backend is asked again
  // every time, so role changes made in the Users sheet apply on the next page load.
  useEffect(() => {
    if (didBootstrap.current) return;
    didBootstrap.current = true;

    const stored = readStoredToken();
    if (stored && msUntilExpiry(stored) > EXPIRY_SKEW_MS) {
      signIn(stored);
    } else {
      clearStoredToken();
      dispatch({ type: 'SIGNED_OUT' });
    }
  }, [signIn]);

  // Google ID tokens last about an hour. Sign out when this one runs out.
  useEffect(() => {
    if (state.status !== 'authenticated') return undefined;
    const timer = setTimeout(
      () => signOut(SESSION_EXPIRED),
      Math.max(msUntilExpiry(state.idToken), 0),
    );
    return () => clearTimeout(timer);
  }, [state.status, state.idToken, signOut]);

  // If the backend ever rejects the token mid-session, end the session.
  useEffect(() => {
    setAuthErrorHandler(() => signOut(SESSION_EXPIRED));
    return () => setAuthErrorHandler(null);
  }, [signOut]);

  const value = useMemo(
    () => ({
      status: state.status,
      user: state.user,
      error: state.error,
      isAuthenticated: state.status === 'authenticated',
      role: state.user?.role ?? null,
      hasRole: (...roles) => roles.includes(state.user?.role),
      signIn,
      signOut,
    }),
    [state.status, state.user, state.error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
