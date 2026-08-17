// Production build entrypoint (Vercel `vercel-build`). Applies any pending
// database migrations BEFORE building, so a deploy can never ship code that
// expects a schema the database doesn't have yet (which surfaces as runtime
// "table/column does not exist" server exceptions).
//
// `prisma migrate deploy` uses `directUrl` (DIRECT_URL) from schema.prisma. Some
// environments only set DATABASE_URL (no pooler / no separate direct URL), so we
// fall back DIRECT_URL -> DATABASE_URL to avoid an "environment variable not
// found" failure. If no database URL is available at build time at all, we skip
// migrations rather than fail the build (migrations are then applied out-of-band
// via `npm run db:deploy`).
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit", env: process.env });

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

const isProd = process.env.VERCEL_ENV === "production" || process.env.NEXT_PUBLIC_APP_ENV === "production";

if (process.env.DATABASE_URL) {
  console.log("→ Applying database migrations (prisma migrate deploy)…");
  run("prisma migrate deploy");
} else if (isProd) {
  // A production deploy must never ship ahead of its schema — that's the exact
  // "table/column does not exist" failure the manual db-repair page exists to
  // rescue. Fail the build instead of silently skipping.
  console.error("✖ Production build has no DATABASE_URL — refusing to build without applying migrations.");
  process.exit(1);
} else {
  console.warn("⚠ No DATABASE_URL at build time (non-production) — skipping migrations. Run `npm run db:deploy` separately.");
}

console.log("→ Building Next.js app…");
run("next build");
