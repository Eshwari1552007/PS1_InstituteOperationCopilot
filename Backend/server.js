const path = require('node:path');
// Anchor dotenv to this Backend directory so starting `node Backend/server.js`
// from the repository root still loads Backend/.env.
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const initializeFirebase = require('./config/firebase');
const createTestRoutes = require('./routes/testRoutes');
const createEnrollmentRoutes = require('./routes/enrollmentRoutes');
const createCopilotRoutes = require('./routes/copilotRoutes');

const app = express();
app.disable('x-powered-by');
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map((origin) => origin.trim());

app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  next();
});

app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { hostname, protocol } = new URL(origin);
      if (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
        return callback(null, true);
      }
    } catch {
      // Invalid origins are rejected below.
    }
  }
  return callback(Object.assign(new Error('Origin is not allowed by CORS.'), { status: 403, code: 'CORS_ORIGIN_DENIED' }));
} }));
app.use(express.json({ limit: '16kb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'edupilot-api' }));
let firebase;
try {
  firebase = initializeFirebase();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  return;
}

if (process.env.NODE_ENV === 'development' && process.env.ENABLE_FIRESTORE_TEST_ENDPOINTS === 'true') {
  app.use('/api/firestore-test', createTestRoutes(firebase.db));
}
app.use('/api/enrollment', createEnrollmentRoutes(firebase));
app.use('/api/copilot', createCopilotRoutes(firebase));
app.use((error, req, res, _next) => {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status >= 500) {
    console.error('Unhandled API error:', { method: req.method, path: req.path, name: error.name || 'Error', code: error.code || 'INTERNAL_ERROR' });
  }
  const knownClientError = status < 500 && typeof error.code === 'string' && typeof error.message === 'string';
  const code = knownClientError ? error.code : status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
  const message = knownClientError ? error.message : status === 400 ? 'The request could not be parsed.' : 'The server could not complete the request.';
  return res.status(status).json({ code, message });
});

const port = Number(process.env.PORT) || 5000;
app.listen(port, () => console.log(`EDUPILOT API listening on port ${port}`));
