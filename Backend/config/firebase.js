const path = require('node:path');
const admin = require('firebase-admin');

function initializeFirebase() {
  if (admin.apps.length) return { admin, db: admin.firestore(admin.app()) };

  const projectId = process.env.FIREBASE_PROJECT_ID || 'edupilot-80fa2';
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const options = { projectId };

  try {
    if (credentialJson) {
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(credentialJson);
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON');
      }
      if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing required service-account fields');
      }
      if (serviceAccount.project_id !== projectId) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON project does not match FIREBASE_PROJECT_ID');
      }
      options.credential = admin.credential.cert(serviceAccount);
    } else if (credentialPath) {
      const resolved = path.resolve(__dirname, '..', credentialPath);
      options.credential = admin.credential.cert(require(resolved));
    } else {
      options.credential = admin.credential.applicationDefault();
    }
    const app = admin.initializeApp(options);
    return { admin, db: admin.firestore(app) };
  } catch (error) {
    error.message = `Firebase Admin initialization failed: ${error.message}. Configure FIREBASE_SERVICE_ACCOUNT_JSON, Application Default Credentials, or GOOGLE_APPLICATION_CREDENTIALS with a valid private service-account JSON.`;
    throw error;
  }
}

module.exports = initializeFirebase;
