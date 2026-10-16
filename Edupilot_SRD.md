# Edupilot – System Requirements Document (SRD)

*Technical requirements in simple language · MERN Stack + Agentic AI*

---

## 1. Purpose

This document explains **what the Edupilot system must do and how it is built**. The PRD says *what the product is and why*. The SRD says *what the system must technically provide*.

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite + Tailwind CSS | Fast to build, clean UI |
| Backend | Node.js + Express | Simple REST API and agent loop |
| Database | MongoDB + Mongoose | Flexible schema, quick to seed |
| AI agent | LLM with tool-calling (Claude or Gemini API) | Plans, calls tools, loops until done |
| Auth | JWT + role middleware | Role access enforced on the server |
| Scheduler | Custom constraint solver in JavaScript | No heavy infra, runs in milliseconds |
| Messaging | WhatsApp click-to-chat link / mock send | Real API not needed for demo |

## 3. System Architecture

Edupilot has four parts that work together:

1. **React frontend** – Login, Dashboard, Students, Batches, Fees, Attendance, Timetable, Copilot, Approvals, Audit Log.
2. **Node + Express API** – checks JWT, then role middleware, then runs controllers.
3. **Services inside the API**
   - *Agent Service*: runs the LLM tool-calling loop.
   - *Scheduler Service*: builds and re-plans the timetable.
   - *Approval + Audit Service*: holds pending actions, runs them only after approval, logs everything.
4. **MongoDB** – one shared database for all modules.

The **external LLM API** receives only role-filtered tool results. It never connects to the database.

### Request flow (Copilot question)

1. User types a question.
2. Server verifies JWT and loads the role.
3. Server gives the LLM only the tools allowed for that role.
4. LLM picks a tool with typed arguments.
5. Server re-checks the role, runs a read-only query, masks restricted fields, records the exact query.
6. Result goes back to the LLM. This repeats up to **5 turns**.
7. LLM writes the answer and may propose an action (stored as a pending action).
8. UI shows answer, table, Query Inspector and action preview.
9. Human approves or rejects. Executor runs only after approval. Audit log is written.

## 4. Functional Requirements

### 4.1 Login and Roles (MUST)

- FR-1: User signs in with email and password.
- FR-2: Passwords are stored as hashes, never as plain text.
- FR-3: Server issues a JWT containing user id and role.
- FR-4: Frontend shows menu items based on role (Trainer has no Fees menu).
- FR-5: Server checks the role on **every** request.

### 4.2 Students (MUST)

- FR-6: Owner and Counselor can add and edit students (name, phone, course, batch).
- FR-7: Searchable and filterable student list.
- FR-8: Student profile shows attendance % and EMI status (EMI hidden from Trainer).
- FR-9: When a student is enrolled, the system creates the EMI plan automatically.
- FR-10: Trainer sees only own batches; Accounts sees name and batch only.

### 4.3 Batches and Courses (MUST)

- FR-11: Owner creates courses (title, duration, total fee).
- FR-12: Owner creates batches (course, trainer, days, time, room, mode, online seats).
- FR-13: Show seat usage for classroom and online.
- FR-14: Counselor assigns students to batches.

### 4.4 Attendance (MUST)

- FR-15: Trainer marks Present or Absent per student for own batches.
- FR-16: Each record has a mode (CLASSROOM or ONLINE) and join time for online.
- FR-17: Online join data is seeded for the demo.
- FR-18: Show class summary and attendance % per student and batch.
- FR-19 (SHOULD): Attach a recording link to each session.

### 4.5 Fees and EMIs (MUST)

- FR-20: Each EMI has status PENDING, PAID or OVERDUE.
- FR-21: Accounts can click **Mark paid**; the action is logged.
- FR-22: An EMI past its due date automatically becomes OVERDUE.
- FR-23: Show cards for collected, pending and overdue totals.
- FR-24: Trainer is fully blocked from fee data.

### 4.6 AI Copilot (MUST)

- FR-25: Chat screen with suggestion chips and a result table.
- FR-26: AI can only call **whitelisted tools** with typed arguments.
- FR-27: Tools shown to the AI depend on the user's role.
- FR-28: Every tool stores the exact query it ran.
- FR-29: Loop is capped at 5 turns.
- FR-30: If a role asks for forbidden data, the Copilot refuses politely and logs a DENIED event.

### 4.7 Query Inspector (MUST)

- FR-31: Under every answer show the exact query, time taken, row count and tools used.
- FR-32: Inspector is read-only.

### 4.8 Approvals (MUST)

- FR-33: Any AI or scheduler change becomes a **pending action** with a preview.
- FR-34: Tabs for Pending, Approved, Rejected.
- FR-35: Human can Approve, Edit or Reject.
- FR-36: Only approved actions are executed.
- FR-37: Owner approves all; Accounts approves fee actions; Counselor approves own reminders.

### 4.9 Audit Log (MUST)

- FR-38: Log every question, tool run, approval, rejection and denial with user, role, time, query and result.
- FR-39: Entries are append-only (never edited or deleted).
- FR-40: Owner can filter by user, event and date. Accounts sees own actions only.
- FR-41: DENIED entries are shown in red.

### 4.10 Timetable (MUST)

- FR-42: **Auto-plan** builds a weekly timetable from trainer availability, rooms, batch timings and online seats.
- FR-43: **Hard rules**: no trainer, room or batch in two places at once; room capacity ≥ batch size; online seats within limit; trainer teaches only in available hours.
- FR-44: **Soft rule**: respect batch timing preference (morning or afternoon) where possible.
- FR-45: **Re-plan** moves only broken sessions (same day first, then another day, then a substitute trainer with the skill).
- FR-46: Each move stores a reason, shown as a plain-language explanation.
- FR-47: Owner can Publish or Undo the new plan.
- FR-48: Re-plan changes are created as an approval item.

### 4.11 Dashboard (SHOULD)

- FR-49: Four KPI cards: active students, EMIs due this week, average attendance, at-risk students.
- FR-50: "Needs attention today" list with quick buttons (Ask Copilot, Re-plan, View).
- FR-51: Attendance-by-batch chart.
- FR-52: Other roles see a smaller version with only their own data.

### 4.12 Bonus Modules

- FR-53: Dropout risk – rule-based score from attendance, payments and assignments; AI writes the reasons.
- FR-54: Certificates – generate a completion PDF per student.
- FR-55: Payment matching – upload UPI/bank CSV and match to expected EMIs.

## 5. Agent Tools

| Tool | Type | Allowed roles | Purpose |
|---|---|---|---|
| findStudents | read | owner, counselor, trainer (own batches) | Search students by name, batch, status |
| attendanceReport | read | owner, counselor, trainer (own batches) | Absences per student, date range |
| emiDue | read | owner, accounts, counselor (status only) | EMIs due or overdue in a window |
| feeSummary | read | owner, accounts | Paid vs pending per student |
| batchOverview | read | all roles | Batch, trainer, room, seats used |
| trainerSchedule | read | owner, counselor, trainer (own) | Weekly sessions and free slots |
| dropoutRisk | read | owner, counselor | Risk score from attendance, payment, assignments |
| draftReminder | propose | owner, counselor, accounts | Creates pending WhatsApp messages |
| proposeReschedule | propose | owner | Creates pending timetable change |
| markEmiPaid | propose | owner, accounts | Creates pending payment update |

**Read tools** return data. **Propose tools** only create a pending action; they never change data themselves.

## 6. Data Model (MongoDB Collections)

| Collection | Key fields |
|---|---|
| users | name, email, passwordHash, role |
| students | name, phone, courseId, batchId, status, joinedAt |
| courses | title, durationWeeks, totalFee |
| batches | courseId, trainerId, mode, days[], startTime, roomId, onlineSeats |
| trainers | userId, skills[], availability [{day, from, to}] |
| rooms | name, capacity |
| emis | studentId, installmentNo, amount, dueDate, status |
| attendance | studentId, batchId, date, mode, status, joinTime |
| recordings | batchId, date, url |
| timetable_slots | batchId, trainerId, roomId, day, start, end, version |
| pending_actions | type, payload, previewText, createdBy, status |
| audit_logs | userId, role, event, toolCalls[], query, result, at |

## 7. REST API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/auth/login | Returns JWT with role |
| GET | /api/students, /api/batches, /api/emis | List screens (role-filtered) |
| GET | /api/dashboard | Dashboard numbers and alerts |
| POST | /api/copilot/ask | Runs agent loop; returns answer, queries, pendingActionId |
| GET | /api/actions?status=PENDING | Approvals queue |
| POST | /api/actions/:id/approve, /reject | Human decision, then executor + audit log |
| POST | /api/timetable/generate, /replan | Auto-plan and re-plan with explanation |
| GET | /api/audit | Audit log viewer |

## 8. Security Requirements

- SEC-1: The LLM never touches the database; it only calls whitelisted tools.
- SEC-2: Each tool re-checks the caller's role on the server. A rule only in the prompt is not enough.
- SEC-3: **Field masking**: fee and EMI fields are removed from tool results for restricted roles *before* they reach the LLM.
- SEC-4: Write actions never run directly; they need approval.
- SEC-5: JWT is verified on every request; passwords are hashed.
- SEC-6: Audit log is append-only.
- SEC-7: API keys are kept in environment variables, never committed to git.
- SEC-8: Tool inputs are validated against typed schemas; no raw Mongo from the LLM.

## 9. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Simple screens load in under 2 seconds; timetable re-plan under 1 second |
| Copilot speed | Answer in a few seconds; show a loading state while waiting |
| Reliability | Cached answers for the 3 demo questions in case the LLM or Wi-Fi fails |
| Usability | Clean UI, suggestion chips, clear empty / loading / error states |
| Compatibility | Works in latest Chrome on laptop; layout responsive |
| Maintainability | Clear folder structure, small modules, README with setup steps |
| Auditability | Every decision traceable to a user, time and query |

## 10. Seed Data Requirements

One seed script must create:

- 4 demo logins (owner, counselor, trainer, accounts)
- 100+ students, 6 batches, 4 trainers, 3 rooms
- EMIs for every student
- 60 days of attendance (classroom and online)
- Deliberate problems: missed EMIs, a double-booked trainer, a nearly full online batch

The demo story (Java batch, Rahul / Sneha / Omkar, trainer Amit) must be reproducible from this data.

## 11. Testing Requirements

| Test | Expected result |
|---|---|
| Trainer asks about fees | Polite refusal + DENIED audit entry |
| Trainer calls fee API directly | 403 error |
| Owner asks Java batch question | Table + exact query shown |
| AI drafts reminders | Pending action created; nothing sent |
| Approve pending action | Executed once + audit entry |
| Reject pending action | Not executed + audit entry |
| Mark trainer unavailable | Re-plan, zero clashes, only affected sessions moved, explanation shown |
| Agent loop runaway | Stops at 5 turns |

## 12. Constraints and Assumptions

- Built in 24 hours by a team of about 4.
- All work is created during the hackathon; libraries and APIs are listed in the README.
- WhatsApp sending is mocked or click-to-chat.
- Online attendance data is seeded, not read from a real class tool.
- The demo has one login per role; the design still works for a bigger institute.

## 13. Suggested Team Split

| Member | Area | Work |
|---|---|---|
| A | Frontend | React screens, chat UI, Query Inspector, approval card, timetable grid |
| B | Backend | Express, auth, RBAC middleware, CRUD APIs, audit log |
| C | AI agent | Tool registry, agent loop, prompts, field masking, pending actions |
| D | Scheduler + data | Seed script, constraint solver, re-plan, demo script |

## 14. Definition of Done

- All MUST features work end to end.
- The 3-minute demo runs twice in a row without errors.
- Role and masking tests pass.
- README has setup steps, four demo logins, library list and an architecture diagram.
- Code is frozen in the last 30 minutes.
