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

if (process.env.DATABASE_URL) {
  console.log("→ Applying database migrations (prisma migrate deploy)…");
  run("prisma migrate deploy");
} else {
  console.warn("⚠ No DATABASE_URL at build time — skipping migrations. Run `npm run db:deploy` separately.");
}

console.log("→ Building Next.js app…");
run("next build");
