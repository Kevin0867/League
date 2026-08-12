# Role-based access — who can see and do what

This is the access checklist for PURE Academy. It documents what each role is
allowed to reach. The console page rules are enforced in code by
`src/lib/access/policy.ts` (used by `src/middleware.ts`), so this file and the
enforcement stay in one place. Edit the policy to change access; treat this doc
as the human-readable source of truth to review.

Roles: **ADMIN** (you, Brett, Stephanie as admins — plus legacy COO/CEO/DIRECTOR),
**COACH**, **PARENT**, **PLAYER**. A person can hold more than one role (e.g. a
parent who also coaches); they get the union of what those roles allow.

Legend: ✅ full · 👁️ view-only · 🚫 no access · ⏳ planned (not built yet)

## Console (`/console`) — staff workspace

| Area | ADMIN | COACH |
|---|---|---|
| Dashboard (`/console`) | ✅ | ✅ (coach dashboard: their sessions & checklist) |
| Season Calendar | ✅ | 👁️ view |
| Schedule | ✅ | 👁️ their practices |
| League (standings/fixtures) | ✅ | 👁️ view |
| Team Build (`/console/teams`) | ✅ manage all | 👁️ view teams · ✅ their roster's **progress notes** · attendance |
| My Profile (`/console/profile`) | ✅ | ✅ their own coach profile & account |
| Inbox (messaging) | ✅ | ✅ (see messaging rules below) |
| **Payments** | ✅ | 🚫 |
| **Access / Users** (role management) | ✅ | 🚫 |
| **Registrations** | ✅ | 🚫 |
| **Facilities** | ✅ | 🚫 |
| **Reports** (financials) | ✅ | 🚫 |
| **Assignment / Boards / Pools** | ✅ | 🚫 |
| **Championship / ACP / Private Lessons** | ✅ | 🚫 |
| **Compliance / Consent log** | ✅ | 🚫 |
| **Coaches directory** (`/console/coaches`) | ✅ | 🚫 (coach uses My Profile) |
| **Coach matching** | ✅ | 🚫 |
| **Season Setup / Import** | ✅ | 🚫 |
| **Broadcasts** | ✅ | 🚫 |

A COACH who types the URL of any 🚫 page is redirected to their console home.
Players/parents who reach `/console` are redirected to the family portal.

## Portal (`/portal`) — families (PARENT / PLAYER)

| Area | PARENT / PLAYER |
|---|---|
| Household home (fees, schedule notices) | ✅ |
| Their team(s) (`/portal/team/[id]`) | ✅ the team(s) they/their kids are on |
| Private lessons | ✅ |
| Pay a fee (Stripe) | ✅ |
| Inbox (messaging) | ✅ (see rules below) |
| Global season / all teams (browse) | ⏳ planned |
| Locations directory | ⏳ planned |
| Coach/admin notes & progress reports (view in portal) | ⏳ planned (currently emailed to parents) |
| Lesson plans | ⏳ planned |

## Messaging — who can each role write to

| Sender | May message |
|---|---|
| ADMIN | anyone |
| COACH | admins, other coaches, and **their team's families** |
| PARENT / PLAYER | admins and coaches |

⏳ These messaging audience limits are **not yet enforced** in the compose UI —
that's the next step after the console lockdown. Today the console lockdown and
page-level access are enforced; messaging scoping is planned.

## What's enforced today vs. planned

**Enforced now (this change):**
- Console page access by role — a COACH can no longer open Payments, Users,
  Registrations, Facilities, Reports, Boards, Compliance, etc. Enforced at the
  edge (`middleware.ts`) with per-page `requireAdmin()` as defense-in-depth.
- API mutations already required admin capability (coaches were always blocked
  from changing admin data); unchanged.

**Planned (say the word and I'll build):**
- Parent portal expansion: global season/teams browse, locations, in-portal
  progress notes & lesson plans.
- Messaging audience limits per the table above.
- Finer team scoping for coaches (see only their own roster's player details,
  not every team's roster).
- Session invalidation on role change (today a demoted user keeps their prior
  access until they log out / their session expires — re-login applies the new
  role immediately).

## How to change access

Edit `src/lib/access/policy.ts`:
- `COACH_CONSOLE_PREFIXES` — the console sections a coach may open.
- `ADMIN_ROLES` — which role strings count as full admins.

Update this doc to match, so the checklist and the code never drift.
