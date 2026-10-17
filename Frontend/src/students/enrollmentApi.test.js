import { vi } from 'vitest';
vi.mock('../firebase', () => ({ auth: { currentUser: null } }));
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: vi.fn(() => ({ type: 'credential' })) },
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider() { return { providerId: 'google.com' }; }),
  FacebookAuthProvider: vi.fn(), GithubAuthProvider: vi.fn(), TwitterAuthProvider: vi.fn(),
  OAuthProvider: vi.fn(), reauthenticateWithCredential: vi.fn(), reauthenticateWithPopup: vi.fn(),
}));

import { auth } from '../firebase';
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth';
import { confirmDemoEnrollment, reauthenticateCurrentStudent } from './enrollmentApi';

beforeEach(() => {
  vi.clearAllMocks(); auth.currentUser = null;
  EmailAuthProvider.credential.mockImplementation(() => ({ type: 'credential' }));
  GoogleAuthProvider.mockImplementation(function GoogleAuthProvider() { return { providerId: 'google.com' }; });
});

test('reauthenticates the current email/password account and refreshes its token', async () => {
  const getIdToken = vi.fn().mockResolvedValue('fresh-token');
  auth.currentUser = { email: 'student@example.test', providerData: [{ providerId: 'password' }], getIdToken };
  await reauthenticateCurrentStudent('correct-password');
  expect(EmailAuthProvider.credential).toHaveBeenCalledWith('student@example.test', 'correct-password');
  expect(reauthenticateWithCredential).toHaveBeenCalledWith(auth.currentUser, expect.any(Object));
  expect(getIdToken).toHaveBeenCalledWith(true);
});

test('uses the signed-in OAuth provider and does not demand a made-up password', async () => {
  const getIdToken = vi.fn().mockResolvedValue('fresh-token');
  auth.currentUser = { providerData: [{ providerId: 'google.com' }], getIdToken };
  await reauthenticateCurrentStudent('');
  expect(GoogleAuthProvider).toHaveBeenCalledTimes(1);
  expect(reauthenticateWithPopup).toHaveBeenCalledWith(auth.currentUser, expect.any(Object));
});

test('does not call a backend when current-user reauthentication fails', async () => {
  auth.currentUser = { providerData: [{ providerId: 'password' }], email: 'student@example.test' };
  reauthenticateWithCredential.mockRejectedValueOnce(Object.assign(new Error('wrong'), { code: 'auth/wrong-password' }));
  await expect(reauthenticateCurrentStudent('wrong-password')).rejects.toMatchObject({ code: 'auth/wrong-password' });
});

test('handles an expired session, unsupported provider, and provider network failure explicitly', async () => {
  await expect(reauthenticateCurrentStudent('anything')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  auth.currentUser = { providerData: [{ providerId: 'phone' }] };
  await expect(reauthenticateCurrentStudent('')).rejects.toMatchObject({ code: 'REAUTH_PROVIDER_UNSUPPORTED' });
  auth.currentUser = { providerData: [{ providerId: 'google.com' }], getIdToken: vi.fn() };
  reauthenticateWithPopup.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'auth/network-request-failed' }));
  await expect(reauthenticateCurrentStudent('')).rejects.toMatchObject({ code: 'auth/network-request-failed' });
});

test('payment request never includes the login password', async () => {
  const getIdToken = vi.fn().mockResolvedValue('id-token');
  auth.currentUser = { getIdToken };
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'DEMO_CONFIRMED' }) });
  await confirmDemoEnrollment({ batchDocId: 'batch-a', learningMode: 'ONLINE', amount: 100, requestId: '12345678-1234-1234-1234-123456789012' });
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).not.toHaveProperty('password');
  expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
});
