# Production go-live status

_Snapshot from the overnight session (2026-08-13)._

Production = Vercel project `pure_academy_production`, branch `production`,
Neon database `ep-solitary-rice-…` (empty except your admin account).
Public URL today: `pureacademyproduction.vercel.app` (custom domain not moved yet).

## Working now ✅
- **Admin login** (`kevin@purepickleball.com`). The whole auth chain is fixed
  (the root cause was an empty `AUTH_SECRET`).
- **Self-service password change** under **My account** (`/console/profile`).
- **Email**: Resend accepts sends (`simulated:false`) — deliverability still to be
  confirmed in the Resend dashboard.
- **Stripe**: live keys present, valid, reachable (`mode:"live"`, status 200).
- **Database**: connected, 3 users, everything else empty (nothing seeded yet).

## Changed overnight
- Password change moved out of the coach area into **My account**; coach-only
  sections now show only for actual coaches.
- **Invites now tell the truth**: if the email fails or is only simulated, the
  Access page says so and the real error is logged. Previously it always said
  "sent" — which is why Brett's and Stephanie's invites looked sent but weren't.
- Removed the temporary diagnostic endpoints (needless attack surface on a
  public repo).
- Verified the whole app builds clean.

## Morning checklist (in order)
1. **Confirm email delivered.** resend.com → Emails/Logs → the test email should
   read **Delivered** (check Spam too). resend.com → Domains → `purepickleball.com`
   should be **Verified**.
2. **Onboard Brett & Stephanie.** Their accounts already exist from the earlier
   (failed) invites, so a fresh invite will say "already exists." Two options:
   have them use **Forgot password** on the login page (works now that email is
   configured), or delete + re-invite. (A one-click "resend invite" button can be
   added quickly if you'd rather.)
3. **Live Stripe webhook.** Stripe (Live) → Developers → Webhooks → Add endpoint
   → `https://academy.purepickleball.com/api/stripe/webhook` → copy its signing
   secret → set `STRIPE_WEBHOOK_SECRET` in Vercel → redeploy. Do this after the
   domain move so the endpoint URL is live.
4. **Move the domain.** Old/test project → Domains → remove
   `academy.purepickleball.com`; new project → Domains → add it. This points the
   live URL at production and fixes emailed links.
5. **Optional integrations** if you want them: `BLOB_READ_WRITE_TOKEN` (photos),
   `TWILIO_*` (SMS), `CRON_SECRET` (reminders).
6. **Seed the season** in the console (Season Setup → teams → coaches).
7. **Security housekeeping:** rotate `SETUP_TOKEN` to a strong value (the `/setup`
   page is locked now, so low risk).

## Known follow-ups
- `DIRECT_URL` is unset in the app — fine; the app never uses it (only the
  migration workflow does, via the `DIRECT_URL_PRODUCTION` GitHub secret).
- Verify the GitHub secret `DATABASE_URL_PRODUCTION` points at the **same**
  database the app uses (`ep-solitary-rice-…`) so future migrations land on
  production, not a stray database.
