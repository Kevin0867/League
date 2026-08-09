# Go-Live Checklist

Everything needed to take the PURE Academy CRM from a working build to a
production system real families can use. Grouped by **launch blockers** and
**fast-follows**, with an owner for each (👤 = you / business, 🤖 = buildable in
the app, ⚙️ = infra/config).

The season opens **September 14**; ACP league + DUPR start **Week 7**. Per the
spec's own advice, it's fine to run later phases manually at first.

---

## 1. Blockers to launch

### Infrastructure & deploy
- [ ] ⚙️ Provision managed **PostgreSQL** (Neon or Supabase). Capture `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
- [ ] ⚙️ Create **Vercel** project from this repo; set build to run `prisma migrate deploy`.
- [ ] ⚙️ Set env vars in Vercel: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `FIELD_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL`.
- [ ] 👤 Point a domain (e.g. `academy.purepickleball.com`); Vercel issues SSL.
- [ ] 👤 Generate and securely store secrets: `AUTH_SECRET` and `FIELD_ENCRYPTION_KEY` (`openssl rand -base64 32`). **Losing `FIELD_ENCRYPTION_KEY` makes encrypted medical/emergency data unrecoverable** — store it in a password manager / secret store.

### Auth product gaps
- [x] 🤖 **Password reset / forgot-password** flow — `/forgot` + `/reset`, single-use 1-hour tokens (emails via Resend when configured; simulated/logged otherwise).
- [x] 🤖 **First-admin bootstrap** — `/setup` creates the initial COO (locks after).
- [x] 🤖 **Staff & coach account creation** — Coaches page → "Add a staff/coach login".
- [x] 🤖 **Login rate-limiting** — account locks 15 min after 5 failed attempts.

> ⚠️ **Vercel gotcha (resolved):** Vercel **Deployment Protection** (Vercel
> Authentication) strips the app's own cookies on the *preview* URL, which breaks
> login there. Keep it **off** for the `league` project's previews (Settings →
> Deployment Protection). It does **not** affect the production domain.

### Payments (Stripe)
- [ ] 👤 Complete Stripe **business onboarding** (bank account, EIN) to receive funds.
- [ ] 👤 Add **live** keys to env: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- [ ] 👤 Create a **webhook** → `https://<domain>/api/stripe/webhook`; put its signing secret in `STRIPE_WEBHOOK_SECRET`.
- [ ] ⚙️ Test one real payment end-to-end in staging (Stripe test mode + test card).

### Email deliverability
- [ ] 👤 Verify a sending domain in **Resend** (add SPF/DKIM DNS records); set `RESEND_API_KEY` and `EMAIL_FROM`.
- [ ] ⚙️ Send test messages to confirm inbox delivery (not spam).

### Real data
- [ ] 🤖 **CSV import tool** for the ~74 existing registrants (with duplicate merge).
- [ ] 👤 Load real **facilities**, **coaches**, **divisions**, **season fee**, and **rate config** (or import).

---

## 2. Fast-follows (launch without; add within days)

### SMS (time-critical alerts)
- [ ] 👤 Twilio account approved (pending) + a sending number.
- [ ] 👤 **A2P 10DLC** brand/campaign registration for US business texting (can take days).
- [ ] 👤 Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. (Sends simulate until then.)

### Automation
- [ ] 🤖 **Vercel Cron** jobs: 48-hour availability escalation; waiver-outstanding and DUPR-outstanding reminders.

### Observability & ops
- [ ] ⚙️ **Error monitoring** (Sentry) + uptime checks.
- [ ] ⚙️ Confirm **automated backups** and run a **restore drill**.
- [ ] ⚙️ Structured logging / request logs.

### Trust, privacy & legal
- [ ] 👤 **Privacy policy** and **Terms of Service** pages (minors' data — take seriously).
- [ ] 👤 Legal review of the **waiver** (checkbox + typed signature) and parental-consent capture; confirm it meets liability needs.
- [ ] 👤 Define a **data retention policy** for minors' data, medical disclosures, emergency contacts.
- [ ] 🤖 Run the repo's **security review** on the branch before real data lands.

### League / DUPR (by Week 7)
- [ ] 👤 Register **ACP** with DUPR as a club + league; load rosters; verify every league player's DUPR identity.
- [ ] 👤 Confirm DUPR's **submission schema** (before designing against it).
- [ ] 🤖 Wire the **real DUPR API** into the existing submission queue (currently simulated).

---

## 3. QA before opening registration
- [ ] Manual walkthrough: register → assign → request fee → **pay (Stripe test)** → attendance.
- [ ] Manual walkthrough: fixture → 7-day notice → 48h confirmation → escalation → score → standings.
- [ ] Verify role scoping (coach can't see other rosters / minors' medical).
- [ ] Verify encryption at rest (sensitive fields are ciphertext in the DB).
- [ ] Automated tests for the highest-consequence paths (payments, assignment, splits).

---

## Environment variables (production)

| Var | Purpose | Required at launch |
|---|---|---|
| `DATABASE_URL` | App DB connection (pooled) | ✅ |
| `DIRECT_URL` | Migrations (direct) | ✅ |
| `AUTH_SECRET` | Session signing | ✅ |
| `FIELD_ENCRYPTION_KEY` | Encrypt minors'/medical data | ✅ |
| `NEXT_PUBLIC_APP_URL` | Absolute URLs (Stripe redirects) | ✅ |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Payments | ✅ (for paid launch) |
| `RESEND_API_KEY` / `EMAIL_FROM` | Email delivery | ✅ (recommended) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | SMS | Fast-follow |
