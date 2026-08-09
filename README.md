# PURE Academy & Arizona Club Pickleball — Season Management CRM

A full CRM for running the PURE Academy season and the Arizona Club Pickleball
(ACP) league — registration, team placement, scheduling, two-sided payments,
DUPR-recorded league play, and communications. Comparable in spirit to TeamSnap
/ SportsEngine / league apps, but built around the way PURE actually operates.

Built to the [PURE Academy Fall 2026 Platform Requirements](#requirements-mapping).

---

## What's here

Three faces on one shared data model:

| Surface | Who | Route |
|---|---|---|
| **Public site** | Anyone (no login) | `/`, `/programs`, `/locations`, `/standings`, `/schedule` |
| **Family portal** | Players & parents | `/portal` |
| **Staff console** | COO, CEO, Director, Coach | `/console` |

Access is role-scoped per spec §17 (COO everything; CEO facilities/financials;
Director teams/coaches/players/scheduling; Coach own teams/roster/earnings;
Player/Parent own record).

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** — one codebase,
  server-rendered public site, both portals, mobile-first (coaches mark
  attendance courtside on a phone, §18).
- **Prisma** ORM on **PostgreSQL**, with committed migration files.
- Custom **JWT sessions** (`jose`) + **bcrypt**, with a role permission matrix.
- **Stripe hosted checkout** for payments — the app never touches card data (§18).
- **Tailwind CSS**.

## Getting started

You need a PostgreSQL database. Point `DATABASE_URL` / `DIRECT_URL` at it (see
`.env.example`), then:

```bash
npm install
cp .env.example .env          # set DATABASE_URL / DIRECT_URL for your Postgres
npm run db:deploy             # apply migrations (prisma migrate deploy)
npm run db:seed               # load demo data
npm run dev                   # http://localhost:3000
```

In this project's dev container a local Postgres is bootstrapped automatically by
a SessionStart hook (`scripts/dev-db.sh`) — it initializes the cluster, starts
the server, applies migrations, and seeds when empty. Run it by hand any time
with `bash scripts/dev-db.sh`. Use `npm run db:migrate` to create a new migration
after editing the schema.

### Demo logins (password: `pickleball`)

| Role | Email |
|---|---|
| COO | `coo@purepickleball.com` |
| CEO | `ceo@purepickleball.com` |
| Academy Director | `director@purepickleball.com` |
| Coach | `sam.coach@purepickleball.com` |
| Player | `emma.player@example.com` |

### Scripts

- `npm run dev` / `build` / `start`
- `npm run db:migrate` — create & apply a migration in dev (after schema edits)
- `npm run db:deploy` — apply committed migrations (CI / production)
- `npm run db:seed` — reset & load demo data
- `npm run db:studio` — Prisma Studio data browser

## Architecture notes

- **The data model is the spine.** `prisma/schema.prisma` models all 11 capability
  areas up front (Person, Registration, Team, Coach, Facility, Session, Payment,
  Season/Division, Fixture/LineMatchup/GameScore, à la carte, Communications,
  Waiver, AuditLog) even though UI ships in phases — because "get these entities
  right and the rest follows" (§2).
- **Money is integer cents everywhere.** Never floats.
- **The custom logic lives in `src/lib/domain/`** — the parts nothing off the
  shelf does (§20): team completeness & publish gates, coach screening gate,
  roster sizing with coach-plays, duplicate detection, à la carte revenue split
  (court cost off the top, rates stamped onto the transaction), and standings
  computed from game-level data so any standings method can be swapped in later.
- **Enum-like values** are Strings with the allowed sets centralized in
  `src/lib/enums.ts` and validated in app code — a deliberate choice for
  zero-churn value changes across seasons. DB-level CHECK constraints can be
  layered via a migration if stricter enforcement is wanted.

## Roadmap (mirrors spec §19 phasing)

- **Foundation (done):** complete data model, auth + RBAC, seed data, public site,
  registration with duplicate detection + waiver capture, team-build board,
  facility agreement tracker, compliance dashboard.
- **Phase 1 (done):** pool → team **assignment engine** (overlapping pools, cap/gate
  enforcement, publish gate); **Stripe hosted checkout** with payment-request-after-
  assignment and webhook reconciliation; the **communications system** —
  audience-resolved messaging (in-app + email + SMS) with per-recipient delivery
  logging and automatic triggers; and **scheduling** — season generation (blackout
  aware), cancellation with per-type rules + practice-cancelled SMS, and courtside
  attendance.
- **Phase 2 (done):** **fixture generation** (round-robin, blackout/Dec-5-6 aware),
  7-day notice + **48-hour availability confirmation with escalation**, **line-up
  DUPR validation** for outside teams, **line-by-line scoring**, **forfeits** with
  championship-eligibility rules, the **DUPR submission queue** (identity-verified,
  retry/error state, forfeits excluded), public standings/results/schedule,
  **month-end facility statements**, and the **coach payout register**.
- **Phase 3 (mostly done):** **à la carte** catalog, booking, and revenue split
  (done); **P&L + retention reporting** and **CSV export** (done). Remaining:
  championship bracket.
- **Phase 4 (partial):** year-end **coach 1099 totals** export (done). Remaining:
  season close-out and rollover to Spring 2027.

### Not yet built / deliberately deferred
- Championship bracket drawing and management.
- The remaining triggered messages (waiver-outstanding and DUPR-outstanding
  reminders) and a scheduled job to fire the 48-hour escalation automatically —
  the escalation logic exists and is triggered manually from the dashboard today.
- Monthly-installment Stripe plans (pay-in-full is wired; the model carries an
  `installmentPlan` flag).
- Live DUPR API submission (schema to be confirmed with DUPR first — the queue,
  identity checks, and retry/error states are all built around it).
- Production hardening: switch Prisma to PostgreSQL, encryption at rest for
  minors'/medical data, automated backups with tested restore.

## Requirements mapping

Key spec sections are cited inline in the code (search for `§`). Highlights:

| Spec | Where |
|---|---|
| §2 Core data model | `prisma/schema.prisma` |
| §3 Registration + duplicate merge | `src/app/register/*`, `src/lib/domain/registrations.ts` |
| §4 Team formation, publish gate | `src/lib/domain/teams.ts`, `src/app/console/teams` |
| §5 Coach screening gate, recruitment credit | `src/lib/domain/teams.ts`, `src/app/console/coaches` |
| §6 Facilities, blackout dates | `prisma/schema.prisma`, `src/app/console/facilities` |
| §0/§11 À la carte split | `src/lib/domain/splits.ts` |
| §12/§14 League scoring, forfeits, standings | `src/lib/domain/standings.ts`, `src/app/standings` |
| §13 Communications & triggers | `src/app/console/messages` |
| §15 Public site, private-court privacy | `src/app/locations`, facility `isPrivate` |
| §17 Roles & permissions | `src/lib/rbac.ts` |
| §18 No card data, mobile-first, audit trail | Stripe checkout, `AuditLog` |

## Production deployment

- Provision a managed PostgreSQL instance; set `DATABASE_URL` (pooled) and
  `DIRECT_URL` (direct, for migrations). Run `npm run db:deploy` on release.
- Set a strong `AUTH_SECRET` (`openssl rand -base64 32`).
- Provision Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) — checkout switches from simulation to
  live automatically when present.
- Provision Twilio (`TWILIO_*`) and Resend (`RESEND_API_KEY`) for SMS/email.

Still to harden before real family data: encryption at rest for minors'/medical
fields, automated backups with a tested restore, and (optionally) DB-level CHECK
constraints on the enum-like columns.
