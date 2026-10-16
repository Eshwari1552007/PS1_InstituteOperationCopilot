require('dotenv').config();
const express = require('express');
const cors = require('cors');
const initializeFirebase = require('./config/firebase');
const createTestRoutes = require('./routes/testRoutes');

const app = express();
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map((origin) => origin.trim());

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
  return callback(new Error('Origin is not allowed by CORS.'));
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

if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_FIRESTORE_TEST_ENDPOINTS === 'true') {
  app.use('/api/firestore-test', createTestRoutes(firebase.db));
}
app.use((error, _req, res, _next) => {
  return res.status(error.status || 400).json({ message: error.message || 'Invalid request.' });
});

const port = Number(process.env.PORT) || 5000;
app.listen(port, () => console.log(`EDUPILOT API listening on port ${port}`));
