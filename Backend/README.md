# EDUPILOT backend

The Express API provides the trusted student enrollment and demo-payment confirmation flow. It verifies Firebase ID tokens, re-reads saved course and batch data with the Admin SDK, validates the advance, checks offline seats, and writes the enrollment, fee, payment, history, and capacity counter in one Firestore transaction.

It also provides a **read-only AI Copilot** at `POST /api/copilot/chat`. The endpoint verifies the caller's Firebase ID token and approved `users/{uid}` role, scopes Firestore reads to that role, and calculates source figures on the backend. Providers are tried in `AI_PROVIDER`, then `AI_FALLBACK_PROVIDERS` order; invalid credentials are skipped for the rest of the backend process, while quota and temporary failures use cooldowns. No raw Firestore documents or student roster are sent to a provider; the question, a short conversation history, and the minimized summary used to generate the response may be sent to whichever provider handles that request. The UI discloses this and identifies the provider that generated the answer. The returned `verifiedAnswer` preserves the backend-calculated summary. Requests are limited to 30 per user per minute; Firestore reads are paginated and capped.

Supported verified summaries include student/enrollment/course counts, low-enrollment batches, fee summaries, saved attendance, timetable sessions, missing weekly teaching hours, schedule conflicts, trainer workload, and an attention summary, subject to each role's permissions. The assistant never executes writes, sends messages, or changes schedules/payments. Unsupported questions receive a limited-scope response rather than a guessed database fact. AI calls use the Node.js built-in `fetch`; no provider SDK package is required.

## Local setup

1. Install dependencies with `npm install` in `Backend`.
2. Copy `.env.example` to `.env` and set `GOOGLE_APPLICATION_CREDENTIALS` to a private Firebase service-account JSON path, or configure Application Default Credentials. Never commit the service-account JSON or `.env`.
3. Keep your provider keys in this backend `.env`: `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `DEEPSEEK_API_KEY`. Set `AI_PROVIDER` for the first provider and `AI_FALLBACK_PROVIDERS` for the next providers in priority order. Model overrides are `GEMINI_MODEL`, `OPENAI_MODEL`, and `DEEPSEEK_MODEL`; leave them blank to use defaults. Only providers actually tried receive the question/summary. Never put provider keys in the React app or commit them.
4. Set `FRONTEND_URL=http://localhost:3000` (or a comma-separated list of trusted frontend origins).
5. Start the API with `npm run dev` from `Backend`; it listens on port 5000 by default. Copilot returns a configuration message until a provider and matching key are set.
6. Start the React frontend. In local development, its `/api` requests use the CRA proxy to `http://localhost:5000`.

## Production deployment

Deploy this API to a trusted server that can use a service account or workload identity with the minimum required Firestore and Firebase Authentication privileges. Configure `FIREBASE_PROJECT_ID`, `FRONTEND_URL`, `PORT`, and credential binding in the hosting environment. Set the frontend build variable `REACT_APP_API_URL` to the deployed API origin, and redeploy the frontend. The Express API is not deployed by Firebase Hosting or by `firebase deploy --only firestore`.

Before using counselor-side enrollments with existing batches, run `npm run backfill:offline-counts` once from `Backend` using the configured Admin credentials. This sets each batch's `offlineEnrolledCount` from active OFFLINE enrollment records so the new counter rules correctly handle legacy batches.

Student confirmation requires a fresh Firebase Authentication sign-in (maximum five-minute token `auth_time`). Email/password users reauthenticate in the browser with their existing account password; OAuth users use their provider popup. The password is never sent to this API or stored. Confirmation records an explicitly simulated demo payment only; it does not transfer money or produce a gateway receipt. Existing legacy `demoPaymentPins` documents are no longer read and remain denied by Firestore rules.

Run backend unit checks with `npm test` in `Backend`.
