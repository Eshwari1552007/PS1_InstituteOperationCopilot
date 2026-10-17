require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const path = require('node:path');
const initializeFirebase = require('../config/firebase');

async function run() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const email = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!projectId || !email) throw new Error('Set FIREBASE_PROJECT_ID and OWNER_EMAIL in Backend/.env.');

  const { auth, db, FieldValue } = initializeFirebase();

  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`Found existing Firebase Authentication user ${user.uid}; password was not changed.`);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    const password = process.env.OWNER_INITIAL_PASSWORD;
    if (!password || password.length < 12) throw new Error('Set OWNER_INITIAL_PASSWORD to a strong password of at least 12 characters before first provisioning.');
    user = await auth.createUser({ email, password, displayName: process.env.OWNER_NAME || 'EDUPILOT Owner', emailVerified: true, disabled: false });
    console.log(`Created the initial Owner Authentication account ${user.uid}.`);
  }

  const profileRef = db.collection('users').doc(user.uid);
  const snapshot = await profileRef.get();
  if (snapshot.exists && snapshot.data().role !== 'OWNER') {
    throw new Error(`A user profile already exists for ${email} with a non-Owner role. Refusing to promote it automatically.`);
  }
  if (snapshot.exists && snapshot.data().role === 'OWNER' && snapshot.data().status === 'APPROVED') {
    console.log('Owner profile is already provisioned and approved; no changes made.');
    return;
  }

  const now = FieldValue.serverTimestamp();
  await profileRef.set({
    uid: user.uid,
    name: user.displayName || process.env.OWNER_NAME || 'EDUPILOT Owner',
    email: user.email,
    role: 'OWNER',
    status: 'APPROVED',
    createdAt: snapshot.exists ? snapshot.data().createdAt || now : now,
    approvedAt: snapshot.exists ? snapshot.data().approvedAt || now : now,
    provisionedBy: 'trusted-admin-script',
  }, { merge: true });
  console.log(`Owner profile ${user.uid} is approved in Firestore.`);
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(`Owner provisioning failed: ${error.message}`);
  process.exit(1);
});
