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
- **Prisma** ORM. **SQLite** for local dev (zero-config); **PostgreSQL** for
  production (encryption at rest, backups, retention).
- Custom **JWT sessions** (`jose`) + **bcrypt**, with a role permission matrix.
- **Stripe hosted checkout** for payments — the app never touches card data (§18).
- **Tailwind CSS**.

## Getting started

```bash
npm install
cp .env.example .env          # DATABASE_URL defaults to SQLite (file:./dev.db)
npm run db:push               # create the schema
npm run db:seed               # load demo data
npm run dev                   # http://localhost:3000
```

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
- `npm run db:push` — sync schema to the database
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
- **Enum-like values** are Strings (SQLite has no native enums), with the allowed
  sets centralized and documented in `src/lib/enums.ts`.

## Roadmap (mirrors spec §19 phasing)

- **Foundation (done):** complete data model, auth + RBAC, seed data, public site,
  registration with duplicate detection + waiver capture, team-build board,
  facility agreement tracker, compliance dashboard, coaches/schedule/payments views.
- **Phase 1 (Week 1):** pool → team **assignment engine**, payment-request-after-
  assignment via Stripe, session cancellation flows, assignment/cancellation
  notifications.
- **Phase 2 (before league):** ACP setup, **DUPR verification** + submission retry
  queue, fixture generation, 7-day notice + 48-hour availability confirmation with
  escalation, line-up DUPR validation, forfeits, line-by-line scoring, month-end
  facility statements, coach payout register.
- **Phase 3 (Week 7+):** à la carte catalog & revenue split, championship bracket,
  P&L + retention reporting.
- **Phase 4 (post-season):** close-out, year-end 1099 totals, rollover to Spring 2027.

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

## Production deployment (later)

Switch `datasource.provider` to `postgresql`, set `DATABASE_URL`, provision Stripe
keys, and set a strong `AUTH_SECRET`. Upgrade enum-like String fields to native
Postgres enums and scalar-list fields to arrays where desired.
