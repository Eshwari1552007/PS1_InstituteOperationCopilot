# EDUPILOT backend

The Express API provides the trusted student enrollment and demo-payment confirmation flow. It verifies Firebase ID tokens, re-reads saved course and batch data with the Admin SDK, validates the advance, checks offline seats, and writes the enrollment, fee, payment, history, and capacity counter in one Firestore transaction.

## Local setup

1. Install dependencies with `npm install` in `Backend`.
2. Copy `.env.example` to `.env` and set `GOOGLE_APPLICATION_CREDENTIALS` to a private Firebase service-account JSON path, or configure Application Default Credentials. Never commit the service-account JSON or `.env`.
3. Set `FRONTEND_URL=http://localhost:3000` (or a comma-separated list of trusted frontend origins).
4. Start the API with `npm run dev` from `Backend`; it listens on port 5000 by default.
5. Start the React frontend. In local development, its `/api` requests use the CRA proxy to `http://localhost:5000`.

## Production deployment

Deploy this API to a trusted server that can use a service account or workload identity with the minimum required Firestore and Firebase Authentication privileges. Configure `FIREBASE_PROJECT_ID`, `FRONTEND_URL`, `PORT`, and credential binding in the hosting environment. Set the frontend build variable `REACT_APP_API_URL` to the deployed API origin, and redeploy the frontend. The Express API is not deployed by Firebase Hosting or by `firebase deploy --only firestore`.

Before using counselor-side enrollments with existing batches, run `npm run backfill:offline-counts` once from `Backend` using the configured Admin credentials. This sets each batch's `offlineEnrolledCount` from active OFFLINE enrollment records so the new counter rules correctly handle legacy batches.

Student confirmation requires a fresh Firebase Authentication sign-in (maximum five-minute token `auth_time`). Email/password users reauthenticate in the browser with their existing account password; OAuth users use their provider popup. The password is never sent to this API or stored. Confirmation records an explicitly simulated demo payment only; it does not transfer money or produce a gateway receipt. Existing legacy `demoPaymentPins` documents are no longer read and remain denied by Firestore rules.

Run backend unit checks with `npm test` in `Backend`.
