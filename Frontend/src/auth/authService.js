/**
 * Authentication transport.
 *
 * This talks to the real backend at POST /api/auth/login and
 * POST /api/auth/forgot-password. There is no credential fallback and no
 * simulated success: when the API is missing the caller receives an
 * "unavailable" AuthError so the UI can say so honestly.
 */

const API_BASE = (process.env.REACT_APP_API_URL || '').replace(/\/+$/, '');
const TOKEN_KEY = 'instituteiq.token';
const USER_KEY = 'instituteiq.user';

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

function readStored(key) {
  try {
    return window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getStoredUser() {
  const raw = readStored(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable (private mode) — nothing to clear */
  }
}

function persist(token, user, remember) {
  const store = remember ? window.localStorage : window.sessionStorage;
  const other = remember ? window.sessionStorage : window.localStorage;
  try {
    other.removeItem(TOKEN_KEY);
    other.removeItem(USER_KEY);
    store.setItem(TOKEN_KEY, token);
    store.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore quota / privacy mode failures */
  }
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError(
      'unreachable',
      `Cannot reach the authentication service${API_BASE ? ` at ${API_BASE}` : ''}. Check that the API server is running.`
    );
  }

  if (response.status === 404 || response.status === 405 || response.status === 501 || response.status === 502) {
    throw new AuthError(
      'unavailable',
      'The authentication API is not connected yet. This screen is wired to POST /api/auth/login and will work as soon as the Express server is running.'
    );
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new AuthError('rejected', payload.message || 'Invalid email or password.');
  }

  return payload;
}

export async function login({ email, password, remember = false }) {
  const data = await post('/api/auth/login', { email, password });
  const token = data.token || data.accessToken;
  const user = data.user || data.profile;

  if (!token || !user) {
    throw new AuthError(
      'unavailable',
      'The authentication API responded without a token. Expected { token, user } from POST /api/auth/login.'
    );
  }

  persist(token, user, remember);
  return { token, user };
}

export async function requestPasswordReset(email) {
  await post('/api/auth/forgot-password', { email });
  return true;
}
