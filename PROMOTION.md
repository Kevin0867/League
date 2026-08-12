# Test platform → Production

Two environments run from **one repo**:

| | Branch | Vercel project | Neon database | Domain | `NEXT_PUBLIC_APP_ENV` | Data |
|---|---|---|---|---|---|---|
| **Test platform** | `main` | existing project | existing (current) DB | current URL / a test domain | `test` | Kept as-is — the seed/demo data lives here for trying things out |
| **Production** | `production` | **new** project | **new, empty** Neon DB | `academy.purepickleball.com` | *(unset)* | Real customers only |

The **amber "Test platform" banner** shows automatically wherever
`NEXT_PUBLIC_APP_ENV=test` (or `staging`) is set, and is invisible in production
(where the var is unset). See `src/components/StagingBanner.tsx`.

Code flows **`main` (test) → `production`**: build and try a change on the test
platform, then promote it to `production` and deploy.

---

## One-time setup (the parts only you can do)

Everything in the repo is ready — the `production` branch, the
`migrate-production` workflow, and the banner. You do the infrastructure:

1. **New Neon database (production).** Create a fresh, empty Neon project/branch.
   Copy its pooled connection string.
2. **GitHub secret.** Repo → Settings → Secrets and variables → Actions → add
   `DATABASE_URL_PRODUCTION` (and optionally `DIRECT_URL_PRODUCTION`) = the new
   Neon string.
3. **Run the production migration.** Actions → **Migrate database (PRODUCTION)**
   → Run workflow on the **`production`** branch. This creates the schema in the
   empty DB (no data).
4. **New Vercel project (production).**
   - Import the same GitHub repo, set the **Production Branch = `production`**.
   - Env vars: `DATABASE_URL` = the production Neon string; `AUTH_SECRET`
     (a fresh strong secret); Stripe **live** keys (`STRIPE_SECRET_KEY`,
     `STRIPE_WEBHOOK_SECRET`); `RESEND_API_KEY`, `EMAIL_FROM`; `BLOB_READ_WRITE_TOKEN`.
     Leave `NEXT_PUBLIC_APP_ENV` **unset**.
   - Point `academy.purepickleball.com` at this project.
5. **Mark the existing project as the test platform.**
   - On the existing (current) Vercel project, set `NEXT_PUBLIC_APP_ENV=test`
     (banner turns on).
   - Give it a non-production domain (e.g. `test.purepickleball.com` or the
     Vercel URL) so the live domain is only production.
   - Keep its `DATABASE_URL` on the current (test) DB — the data stays.
   - Use Stripe **test** keys here so test payments never hit live.
6. **Create the first admin (production starts with zero users).** A fresh DB
   has no accounts, so nobody can log in yet.
   - Add repo secret `ADMIN_BOOTSTRAP_PASSWORD` (≥ 8 chars) in Settings →
     Secrets and variables → Actions.
   - Actions → **Create production admin** → Run workflow on the **`production`**
     branch. Fill in your email / first / last. It creates one ADMIN account
     (idempotent — re-running just resets that account's role + password).
   - Log in at `/login` with that email and `ADMIN_BOOTSTRAP_PASSWORD`, then
     change the password in the console immediately.
7. **Seed the real season on production** via the console (Season Setup, teams,
   coaches, etc.) — production starts empty by design.

## Day-to-day: promoting a change

1. Build and verify on the **test platform** (`main`).
2. Promote to production:
   ```
   git checkout production
   git merge --ff-only main      # or cherry-pick specific commits
   git push origin production
   ```
   (Vercel auto-deploys the production project from `production`.)
3. If the change includes a **new migration**, run **Migrate database
   (PRODUCTION)** on the `production` branch **before** the deploy. The Vercel
   build does **not** auto-migrate (`vercel-build` is just `next build`) — the
   database schema is owned entirely by the migrate workflows, so a new
   migration only reaches a database when you run its workflow. The Prisma
   `DIRECT_URL` is likewise only needed by those workflows (from the
   `DIRECT_URL_PRODUCTION` GitHub secret), not by the running app.

## Notes

- The two databases are fully independent: `migrate.yml` (`DATABASE_URL`) migrates
  the test DB; `migrate-production.yml` (`DATABASE_URL_PRODUCTION`) migrates prod.
- Nothing about this changes the test platform's data — it stays exactly as it is.
- Stripe/Resend/Blob should use **separate keys** per environment so test activity
  never touches live customers or charges.
