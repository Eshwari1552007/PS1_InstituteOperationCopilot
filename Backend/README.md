# EDUPILOT backend

The Express API provides the trusted student enrollment and demo-payment confirmation flow. It verifies Firebase ID tokens, re-reads saved course and batch data with the Admin SDK, validates the advance, checks offline seats, and writes the enrollment, fee, payment, history, and capacity counter in one Firestore transaction.

It also provides a **read-only AI Copilot** at `POST /api/copilot/chat`. The endpoint verifies the caller's Firebase ID token and approved `users/{uid}` role, scopes Firestore reads to that role, and calculates source figures on the backend. Providers are tried in `AI_PROVIDER`, then `AI_FALLBACK_PROVIDERS` order; provider failures use bounded cooldowns and are retried automatically. If every provider is cooling down, the API returns the verified data answer and identifies that AI formatting is temporarily unavailable. No raw Firestore documents or student roster are sent to a provider; the question, a short conversation history, and the minimized summary used to generate the response may be sent to whichever provider handles that request. The UI discloses this and identifies the provider that generated the answer. The returned `verifiedAnswer` preserves the backend-calculated summary. Requests are limited to 30 per user per minute; Firestore reads are paginated and capped.

Supported verified summaries include student/enrollment/course counts, low-enrollment batches, fee summaries, saved attendance, timetable sessions, missing weekly teaching hours, schedule conflicts, trainer workload, and an attention summary, subject to each role's permissions. The assistant never executes writes, sends messages, or changes schedules/payments. Unsupported questions receive a limited-scope response rather than a guessed database fact. AI calls use the Node.js built-in `fetch`; no provider SDK package is required.

## Local setup

1. Use Node.js 22 or newer, then install dependencies with `npm install` in `Backend`.
2. Copy `.env.example` to `.env` and set `GOOGLE_APPLICATION_CREDENTIALS` to a private Firebase service-account JSON path, or configure Application Default Credentials. Never commit the service-account JSON or `.env`.
3. Keep your provider keys in this backend `.env`: `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `DEEPSEEK_API_KEY`. Set `AI_PROVIDER` for the first provider and `AI_FALLBACK_PROVIDERS` for the next providers in priority order. Model overrides are `GEMINI_MODEL`, `OPENAI_MODEL`, and `DEEPSEEK_MODEL`; leave them blank to use defaults. Only providers actually tried receive the question/summary. Never put provider keys in the React app or commit them.
4. Set `FRONTEND_URL=http://localhost:3000` (or a comma-separated list of trusted frontend origins).
5. Start the API with `npm run dev` from `Backend`; it listens on port 5000 by default. Copilot returns a configuration message until a provider and matching key are set.
6. Start the React frontend. In local development, Vite proxies `/api` requests to `http://localhost:5000`.

## Production deployment

### Render: deploy the API and frontend separately

1. Create a **Web Service** from this repository with root directory `Backend`, runtime **Node**, build command `npm ci`, and start command `npm start`. Set `NODE_VERSION=24.21.0` and `NODE_ENV=production`.
2. Add backend environment variables in Render: `FIREBASE_PROJECT_ID`, `FRONTEND_URL` (the exact deployed frontend origin, with no trailing slash), and `FIREBASE_SERVICE_ACCOUNT_JSON` (the complete service-account JSON). Render injects `PORT`; do not hard-code it. Add your AI provider keys and provider-order settings here only. Keep `ENABLE_DEMO_PAYMENTS=false`.
3. Create a **Static Site** from the same repository with root directory `Frontend`, build command `npm ci && npm run build`, and publish directory `dist`. Set `NODE_VERSION=24.21.0`. Add the `REACT_APP_FIREBASE_*` values from `Frontend/.env.example`, plus `REACT_APP_API_URL` set to the backend's HTTPS origin. These frontend Firebase web configuration values are public client config; never put service-account or AI provider secrets in frontend variables.
4. Add a Static Site rewrite from `/*` to `/index.html` with action **Rewrite**, so direct visits to client-side routes load the app. Deploy the frontend, copy its public URL into the backend's `FRONTEND_URL`, then redeploy the backend.
5. In Firebase Authentication, add the frontend's Render domain to **Authorized domains**. Publish the repository's `firestore.rules` and `firestore.indexes.json` to the same Firebase project. Check both Render deploy logs and browser network/console for startup, CORS, and Firebase errors.

For `FIREBASE_SERVICE_ACCOUNT_JSON`, paste the complete JSON object as one Render secret value; keep its JSON escapes intact. The local `GOOGLE_APPLICATION_CREDENTIALS` file remains supported. Never commit either credential source or any `.env` file. The Express API is not deployed by Firebase Hosting or by `firebase deploy --only firestore`.

Before using counselor-side enrollments with existing batches, run `npm run backfill:offline-counts` once from `Backend` using the configured Admin credentials. This sets each batch's `offlineEnrolledCount` from active OFFLINE enrollment records so the new counter rules correctly handle legacy batches.

Student confirmation requires a fresh Firebase Authentication sign-in (maximum five-minute token `auth_time`). Email/password users reauthenticate in the browser with their existing account password; OAuth users use their provider popup. The password is never sent to this API or stored. Confirmation records an explicitly simulated demo payment only; it does not transfer money or produce a gateway receipt. Existing legacy `demoPaymentPins` documents are no longer read and remain denied by Firestore rules.

Production disables simulated enrollment payments unless `ENABLE_DEMO_PAYMENTS=true` is explicitly set. Do not enable that option for real enrollments; connect and verify a payment gateway first. Student installment submissions are stored as `PENDING` and do not reduce the balance until an approved Owner or Accounts user verifies receipt in Fees & EMI.

Run backend unit checks with `npm test` in `Backend`.
