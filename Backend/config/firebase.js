const path = require('node:path');
const admin = require('firebase-admin');

function initializeFirebase() {
  if (admin.apps.length) return { admin, db: admin.firestore(admin.app()) };

  const projectId = process.env.FIREBASE_PROJECT_ID || 'edupilot-80fa2';
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const options = { projectId };

  try {
    if (credentialPath) {
      const resolved = path.resolve(__dirname, '..', credentialPath);
      options.credential = admin.credential.cert(require(resolved));
    } else {
      options.credential = admin.credential.applicationDefault();
    }
    const app = admin.initializeApp(options);
    return { admin, db: admin.firestore(app) };
  } catch (error) {
    error.message = `Firebase Admin initialization failed: ${error.message}. Configure Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS with a valid private service-account JSON.`;
    throw error;
  }
}

module.exports = initializeFirebase;
