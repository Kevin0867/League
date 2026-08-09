# Deploy guide — Vercel + Neon

Exact steps to take the app live. Do them in order. Steps marked 👤 are yours;
the app already handles migrations, schema, and first-admin setup for you.

---

## 1. Database — Neon 👤

1. Sign up at **neon.tech** (Continue with GitHub).
2. Create a project: name `pure-academy`, Postgres 16, region **AWS US West 2 (Oregon)**.
3. From **Connection Details**, copy two strings:
   - **Pooled** (toggle "Pooled connection" ON; host contains `-pooler`) → `DATABASE_URL`
   - **Direct** (toggle OFF; host without `-pooler`) → `DIRECT_URL`
4. Keep both handy (they include the password + `?sslmode=require`). Don't create tables — the app does that on first deploy.

## 2. Secrets 👤

Generate two secrets and store them in a password manager:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -base64 32   # FIELD_ENCRYPTION_KEY
```

⚠️ **FIELD_ENCRYPTION_KEY is permanent** once real data is encrypted — losing it
makes medical/emergency data unrecoverable. Set it once and never change it.

Also pick an **INTAKE_API_KEY** (any long random string) for the signup pipeline.

## 3. Vercel 👤

1. Sign up at **vercel.com** (Continue with GitHub) and **Add New → Project**.
2. Import **Kevin0867/League**. Framework auto-detects **Next.js**. Don't deploy yet.
3. Open **Environment Variables** and add (Production + Preview):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** string |
   | `DIRECT_URL` | Neon **direct** string |
   | `AUTH_SECRET` | from step 2 |
   | `FIELD_ENCRYPTION_KEY` | from step 2 |
   | `INTAKE_API_KEY` | from step 2 |
   | `NEXT_PUBLIC_APP_URL` | `https://<your-vercel-domain>` (update after step 5) |

4. Click **Deploy**. The build runs `prisma migrate deploy` (creates all tables in
   Neon) then builds the app. No manual DB setup, no seed.

## 4. Create the first administrator 👤

1. Visit **`https://<your-deploy>/setup`**.
2. Create the COO account (name, email, password). This page **locks itself** once
   an admin exists. You're signed straight into the console.
3. From the console you'll load real facilities, coaches, divisions, the season,
   and the fee/rate config.

## 5. Custom domain 👤 (optional but recommended)

1. Vercel → Project → **Settings → Domains** → add `academy.purepickleball.com`.
2. Add the CNAME it shows at your DNS provider.
3. Update `NEXT_PUBLIC_APP_URL` to the final `https://academy.purepickleball.com`
   and redeploy.

## 6. Payments — Stripe 👤

1. In the Stripe dashboard, **Developers → API keys**: copy the **Publishable** and
   **Secret** keys (use **test** keys first). Add to Vercel:
   - `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
2. **Developers → Webhooks → Add endpoint**:
   - URL: `https://<domain>/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`
   - Copy the **Signing secret** → `STRIPE_WEBHOOK_SECRET` in Vercel. Redeploy.
3. Test with card `4242 4242 4242 4242` (any future date/CVC) in test mode.
4. When ready for real money: finish Stripe **business onboarding** (bank, EIN) and
   swap test keys for **live** keys.

## 7. Email — Resend 👤

1. Sign up at **resend.com**, **Add Domain**, add the SPF/DKIM DNS records it shows,
   verify.
2. Create an API key. Add to Vercel: `RESEND_API_KEY`, `EMAIL_FROM`
   (e.g. `PURE Academy <noreply@purepickleball.com>`). Redeploy.
3. Until this is set, emails are simulated (logged, not sent).

## 8. Connect your signup form (automatic intake) 👤

Two options — pick one:

**A. Use the built-in form (simplest).** Point your website's "Enroll" button at
`https://<domain>/register`. Submissions create player records instantly.

**B. Keep your existing enrollment form.** Send each submission to the intake API:

```
POST https://<domain>/api/intake/registration
Header: x-api-key: <INTAKE_API_KEY>
Content-Type: application/json

{
  "firstName": "Jane", "lastName": "Doe",
  "email": "jane@example.com", "phone": "480-555-0100",
  "dob": "2010-05-01",
  "divisionName": "Youth — Middle School",
  "practiceTimePref": "weeknight",
  "locationPrefs": [{ "facilityName": "Scottsdale Ranch Pickleball Complex", "rank": 1 }],
  "waiver": { "signed": true, "signatureName": "Parent Name", "parentalConsent": true },
  "emergency": { "name": "John Doe", "phone": "480-555-0101", "relation": "Parent" }
}
```

Most form tools (Jotform, Typeform, Gravity Forms, Google Forms) can do this via a
**Zapier/Make** "webhook" action: trigger = new submission, action = POST to the
URL above with the header and mapped fields. Response `201` = created, `200` with
`"duplicate": true` = matched an existing person (auto-merged).

## 9. Go-live QA (in staging) 👤🤖

- Register → assign to a team → request fee → **pay (Stripe test)** → mark attendance.
- Fixture → 7-day notice → 48h confirmation → escalation → enter scores → standings.
- Confirm a coach can't see another team's roster or minors' medical data.

---

See `GO_LIVE.md` for the full production checklist (backups, monitoring, SMS/A2P,
privacy/legal, DUPR API).
