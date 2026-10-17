import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

export const PUBLIC_ROLES = ['STUDENT', 'COUNSELOR', 'TRAINER', 'ACCOUNTS'];
export const STAFF_ROLES = ['COUNSELOR', 'TRAINER', 'ACCOUNTS'];

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export function observeAuth(callback, onError) {
  return onAuthStateChanged(auth, callback, onError);
}

export async function getUserProfile(user) {
  if (!user) return null;
  const snapshot = await getDoc(doc(db, 'users', user.uid));
  return snapshot.exists() ? { uid: user.uid, ...snapshot.data() } : null;
}

function readableAuthError(error) {
  const messages = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/user-disabled': 'This account has been disabled. Contact the institute Owner.',
    'auth/user-not-found': 'No account was found for that email.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account already exists for this email. Sign in or reset your password.',
    'auth/weak-password': 'Choose a password with at least 6 characters.',
    'auth/network-request-failed': 'Could not reach Firebase. Check your internet connection and try again.',
    'permission-denied': 'Firebase blocked this request. Check the project configuration and Firestore Security Rules.',
  };
  return messages[error.code] || error.message || 'The request could not be completed.';
}

export async function login({ email, password, role, remember = false }) {
  try {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getUserProfile(credential.user);
    if (!profile) throw new AuthError('profile-missing', 'Your account does not have an EDUPILOT profile yet. Complete profile recovery below.');
    if (profile.status === 'PENDING') {
      await signOut(auth);
      throw new AuthError('account-pending', 'Your staff registration is waiting for Owner approval.');
    }
    if (profile.status === 'REJECTED') {
      await signOut(auth);
      throw new AuthError('account-rejected', profile.rejectionReason ? `Your request was not approved: ${profile.rejectionReason}` : 'Your registration request was not approved. Contact the institute Owner.');
    }
    if (profile.status !== 'APPROVED') {
      await signOut(auth);
      throw new AuthError('account-disabled', 'This account is not active. Contact the institute Owner.');
    }
    if (profile.role !== role) {
      await signOut(auth);
      throw new AuthError('role-mismatch', 'That account does not have the selected role. Choose the role assigned by your institute.');
    }
    if (profile.role === 'STUDENT') {
      const phone = String(profile.phone || '').trim().replace(/[\s()-]/g, '');
      if (!/^\+?[1-9]\d{7,14}$/.test(phone)) throw new AuthError('student-phone-missing', 'Your account needs a valid phone number before EDUPILOT can create your student record. Ask the Owner to update your profile.');
      await ensureStudentRecord(credential.user, profile.name, phone);
    }
    return { user: credential.user, profile };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(error.code || 'auth-error', readableAuthError(error));
  }
}

export async function register({ name, email, phone = '', password, role }) {
  if (!PUBLIC_ROLES.includes(role)) throw new AuthError('invalid-role', 'Choose a supported registration role.');
  try {
    const normalizedPhone = String(phone).trim().replace(/[\s()-]/g, '');
    if (role === 'STUDENT' && !/^\+?[1-9]\d{7,14}$/.test(normalizedPhone)) throw new AuthError('invalid-phone', 'Enter a valid phone number including country code when needed.');
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    const staff = STAFF_ROLES.includes(role);
    const profile = {
      uid: credential.user.uid,
      name,
      email: credential.user.email,
      role,
      status: staff ? 'PENDING' : 'APPROVED',
      ...(role === 'STUDENT' ? { phone: normalizedPhone } : {}),
      createdAt: serverTimestamp(),
      ...(staff ? {} : { approvedAt: serverTimestamp() }),
    };
    try {
      await setDoc(doc(db, 'users', credential.user.uid), profile);
      if (role === 'STUDENT') await ensureStudentRecord(credential.user, name, normalizedPhone);
    } catch (error) {
      throw new AuthError('registration-incomplete', `Your Firebase account was created, but its profile could not be saved. You are signed in; use the profile recovery form to retry. ${readableAuthError(error)}`);
    }
    return { user: credential.user, profile };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(error.code || 'auth-error', readableAuthError(error));
  }
}

export async function completeProfile({ user, name, role, phone = '' }) {
  if (!PUBLIC_ROLES.includes(role)) throw new AuthError('invalid-role', 'Choose a supported registration role.');
  const staff = STAFF_ROLES.includes(role);
  try {
    const normalizedPhone = String(phone).trim().replace(/[\s()-]/g, '');
    if (role === 'STUDENT' && !/^\+?[1-9]\d{7,14}$/.test(normalizedPhone)) throw new AuthError('invalid-phone', 'Enter a valid phone number including country code when needed.');
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      name,
      email: user.email,
      role,
      status: staff ? 'PENDING' : 'APPROVED',
      ...(role === 'STUDENT' ? { phone: normalizedPhone } : {}),
      createdAt: serverTimestamp(),
      ...(staff ? {} : { approvedAt: serverTimestamp() }),
    });
    if (role === 'STUDENT') await ensureStudentRecord(user, name, normalizedPhone);
    if (name && user.displayName !== name) await updateProfile(user, { displayName: name });
  } catch (error) {
    throw new AuthError(error.code || 'profile-error', readableAuthError(error));
  }
}

export async function ensureStudentRecord(user, name, phone) {
  const studentRef = doc(db, 'students', user.uid);
  const year = new Date().getFullYear();
  const sequenceRef = doc(db, 'sequences', `student-${year}`);
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(studentRef);
    if (existing.exists() && existing.data().studentId) return;
    const sequence = await transaction.get(sequenceRef);
    const next = Number(sequence.data()?.lastNumber || 0) + 1;
    const studentId = `STU-${year}-${String(next).padStart(4, '0')}`;
    const idRef = doc(db, 'studentIds', studentId);
    const idSnapshot = await transaction.get(idRef);
    if (idSnapshot.exists()) throw new Error('Student ID allocation conflicted. Please retry signup.');
    const now = serverTimestamp();
    transaction.set(studentRef, {
      studentId, authUid: user.uid, fullName: name.trim(), email: user.email.toLowerCase(), phone,
      dateOfBirth: '', gender: '', course: '', batch: '', courseDocId: '', courseId: '', batchDocId: null, batchId: null,
      admissionDate: new Date().toISOString().slice(0, 10), status: 'ACTIVE', accountStatus: 'ACTIVE', enrollmentStatus: 'NONE', isArchived: false,
      address: '', guardianName: '', guardianPhone: '', createdAt: existing.exists() ? existing.data().createdAt : now,
      updatedAt: now, createdBy: user.uid, updatedBy: user.uid,
    });
    transaction.set(idRef, { studentDocId: user.uid, createdAt: now, createdBy: user.uid });
    transaction.set(sequenceRef, { lastNumber: next, lastStudentId: studentId, lastStudentDocId: user.uid, updatedAt: now });
  });
}

export async function requestPasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    throw new AuthError(error.code || 'auth-error', readableAuthError(error));
  }
}

export function logout() {
  return signOut(auth);
}

export async function reviewRegistration({ uid, approve, reason, ownerUid }) {
  const profileRef = doc(db, 'users', uid);
  try {
    await updateDoc(profileRef, {
      status: approve ? 'APPROVED' : 'REJECTED',
      approvedAt: approve ? serverTimestamp() : null,
      approvedBy: ownerUid,
      reviewedAt: serverTimestamp(),
      ...(approve ? { rejectionReason: null } : { rejectionReason: reason.trim() || 'No reason provided.' }),
    });
  } catch (error) {
    throw new AuthError(error.code || 'review-error', readableAuthError(error));
  }
}
