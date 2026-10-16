# Edupilot – Product Requirements Document (PRD)

*AI Operations Copilot for Training Institutes · Open Track · MERN Stack + Agentic AI · 24-Hour Hackathon*

---

## 1. What is Edupilot?

Edupilot is a web portal for training institutes (coaching classes). It keeps students, batches, fees, attendance and trainer timings in **one place**. On top of that sits an **AI Copilot**: staff type a question in normal English and get an answer, plus proof of how the answer was found.

Think of it as a smart manager who knows everything about the institute, answers in seconds, but **always asks permission before doing anything important**.

## 2. The Problem

Most institutes run on Excel sheets, WhatsApp groups and memory.

- Data is scattered in many places.
- The owner spends hours on simple questions like *"Who has not paid this month?"* or *"Which trainer is free on Wednesday?"*
- Problems (missed EMIs, absent students, trainer clashes) are noticed only after damage is done.
- Making a timetable by hand is slow, and any change (trainer on leave) breaks it.

## 3. Goals

1. Give staff one portal for all institute data.
2. Let staff ask questions in plain language and get correct answers fast.
3. Make the AI **safe**: read-only, role-checked, human-approved, fully logged.
4. Make every answer **verifiable** by showing the exact query used.
5. Build a clash-free weekly timetable that re-plans in seconds and explains its changes.

## 4. Non-Goals (what we are NOT building)

- Student login or a student app. Students are records, not users.
- A real WhatsApp Business API (we use a click-to-chat link or a mock send).
- Online payment gateway or real bank integration.
- Mobile app. The portal is a responsive web app only.

## 5. Users and Roles

Only institute **staff** use Edupilot. There are 4 roles.

| Role | What they do | Special rule |
|---|---|---|
| Owner | Sees everything, approves actions, controls timetable | Full access |
| Counselor | Talks to students, checks batches and attendance, drafts reminders | Sees fee **status** only, not amounts |
| Trainer | Marks attendance, sees own batches and timetable | **Never** sees fee details |
| Accounts | Handles fees, EMIs, payments | Sees students by name + batch only |

Demo plan: 1 login per role, so judges can switch roles easily.

## 6. Key User Stories

- As an **Owner**, I want to ask *"Which Java students missed 3+ classes and have an EMI due this week?"* so I can act quickly.
- As an **Owner**, I want to see the exact query the AI ran so I can trust the numbers.
- As a **Counselor**, I want the AI to draft WhatsApp reminders, so I don't write each one by hand.
- As an **Owner/Accounts**, I want to approve, edit or reject every AI-made action before it happens.
- As a **Trainer**, I want to mark classroom and online attendance quickly.
- As a **Trainer**, I should get a polite refusal if I ask about fees.
- As an **Owner**, I want to mark a trainer unavailable and see the timetable fix itself with reasons.
- As an **Owner**, I want an audit log showing who did what and when.

## 7. Features (with priority)

**MUST HAVE**

| # | Feature | Short description |
|---|---|---|
| 1 | Login and Roles | Email + password, JWT, 4 roles, menu changes by role |
| 2 | Students | Add, search, filter, profile with attendance % and EMI status |
| 3 | Batches and Courses | Courses, batches, trainers, rooms, classroom and online seats |
| 4 | Attendance | Mark present/absent, mode CLASSROOM or ONLINE with join time |
| 5 | Fees and EMIs | EMI plan per student, status PENDING / PAID / OVERDUE, Mark paid |
| 6 | AI Copilot | Chat with safe read-only tools, result table, suggestion chips |
| 7 | Query Inspector | Shows exact query, time taken and tools used under every answer |
| 8 | Approvals | AI actions wait as a preview; Approve / Edit / Reject |
| 9 | Audit Log | Permanent record of questions, tool runs, approvals, denials |
| 10 | Timetable | Clash-free weekly plan, instant re-plan with explanation, Undo / Publish |

**SHOULD HAVE**

- Dashboard with 4 KPI cards, "Needs attention today" list, attendance-by-batch chart.
- Recording link attached to each class session.
- Polished empty, loading and error states.

**BONUS (only if ahead of schedule)**

1. Dropout-risk score with reasons (rule-based score, AI writes the reasons).
2. Completion certificate PDF.
3. UPI / bank statement matching against expected EMIs.

## 8. The Safety Promise (core of the product)

1. The AI can **only read** data through pre-built safe tools.
2. Anything that changes data or sends a message is shown as a **preview** first. A human must approve.
3. Roles are checked **on the server**, not just in the AI prompt.
4. Fee fields are removed **before** data reaches the AI for roles that must not see them.
5. Every question, query and approval is logged with who, what and when.

## 9. Role Access Summary

| Data / Action | Owner | Counselor | Trainer | Accounts |
|---|---|---|---|---|
| Student profiles | All | All | Own batches | Name + batch only |
| Attendance | All | All | Own batches (can mark) | No |
| Fee and EMI amounts | All | Status only | **Never** | All |
| Timetable | View + re-plan | View | Own only | No |
| Approve actions | All | Own reminders | No | Fee reminders |
| Audit log | All | No | No | Own actions |

## 10. Success Metrics

- The full 3-minute demo works end to end with realistic data.
- Every Copilot answer shows its query.
- Trainer asking about fees is refused **and** logged as DENIED, 100% of the time.
- No AI action runs without approval.
- Timetable has zero clashes; re-plan finishes in under 1 second and moves the fewest classes.
- Re-plan explanation is readable by a non-technical person.

## 11. Demo Scenario (must work)

1. Owner opens the dashboard: 17 EMIs due, 9 at-risk students.
2. Owner asks the Java batch question, gets a table, opens the Query Inspector.
3. Owner approves 3 WhatsApp reminders; the Audit Log shows the entry.
4. Switch to Trainer, ask about fees: polite refusal and a DENIED log.
5. Mark trainer Amit unavailable: timetable re-plans with an explanation.

## 12. Scope and Timeline (24 hours)

| Hours | Work |
|---|---|
| 0–2 | Setup: repo, Vite + Express, MongoDB Atlas, API keys |
| 2–6 | Models, seed script, login and role middleware, app layout |
| 6–12 | Agent loop, read tools, Query Inspector, chat UI |
| 12–16 | Role guard and masking tests, approvals queue and UI |
| 16–19 | Audit log, dashboard |
| 19–22 | Timetable generator, re-plan, timetable UI |
| 22–23.5 | Bonus (dropout risk), bug fixing, polish |
| 23.5–24 | Code freeze, README, rehearse demo twice |

## 13. Risks and Fallbacks

| Risk | Fallback |
|---|---|
| LLM rate limit or Wi-Fi failure | Cached answers for the 3 demo questions + screen recording |
| WhatsApp API not available | `wa.me` click-to-chat link or mock send |
| Scope creep | Finish all MUST items before any BONUS item |
| Weak demo data | One seed script with deliberate problems (missed EMIs, a double-booked trainer) |

## 14. Hackathon Rules Checklist

- List every open-source library and public API in the README.
- All work must be created during the hackathon and be our own.
- README must include setup steps, demo logins for all four roles, and a short architecture diagram.

## 15. Simple Glossary

| Word | Meaning |
|---|---|
| Agent | An AI that plans steps, uses tools and checks results instead of answering once |
| Tool | A small ready-made function the AI may call, like "get absent students" |
| EMI | A monthly instalment of a student's course fee |
| Query | The exact database search that produced an answer |
| Audit log | A permanent diary of who did what and when |
| RBAC | Role-based access: each user type sees only what it is allowed to |
