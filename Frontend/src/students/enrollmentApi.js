import { auth } from '../firebase';
import {
  EmailAuthProvider,
  FacebookAuthProvider,
  GithubAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  TwitterAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth';

async function request(path, body, forceRefresh = false) {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('Sign in again to continue.'), { code: 'AUTH_REQUIRED' });
  const token = await user.getIdToken(forceRefresh);
  const baseUrl = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/enrollment${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || 'The enrollment service could not complete this request.'), { code: data.code || 'REQUEST_FAILED', status: response.status });
  return data;
}

export const getOfflineEnrollmentCounts = (batchDocIds) => request('/availability', { batchDocIds });

export async function reauthenticateCurrentStudent(password) {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('Your session expired. Sign in again.'), { code: 'AUTH_REQUIRED' });
  const providers = user.providerData.map((item) => item.providerId);
  if (providers.includes('password')) {
    if (typeof password !== 'string' || !password) throw Object.assign(new Error('Enter your EDUPILOT account password.'), { code: 'PASSWORD_REQUIRED' });
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  } else {
    const providerId = providers.find((id) => id !== 'firebase' && id !== 'phone');
    const provider = providerId === 'google.com' ? new GoogleAuthProvider()
      : providerId === 'facebook.com' ? new FacebookAuthProvider()
        : providerId === 'github.com' ? new GithubAuthProvider()
          : providerId === 'twitter.com' ? new TwitterAuthProvider()
            : providerId === 'apple.com' ? new OAuthProvider('apple.com') : null;
    if (!provider) throw Object.assign(new Error('This account provider cannot reauthenticate in this browser. Sign out and sign in again, then retry.'), { code: 'REAUTH_PROVIDER_UNSUPPORTED' });
    await reauthenticateWithPopup(user, provider);
  }
  // Refresh so the backend receives an ID token with the new auth_time.
  await user.getIdToken(true);
}

export const confirmDemoEnrollment = (payload) => request('/confirm-demo', payload, true);
