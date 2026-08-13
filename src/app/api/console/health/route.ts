import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/notify";

// TEMPORARY production smoke-test endpoint. Runs inside the app (so it sees the
// exact database + env the live site uses) and reports: database connectivity +
// row counts for the key models, presence of every required environment
// variable, Stripe key validity/mode, and — with ?sendTest=1&to=<addr> — a real
// outbound email whose provider result is returned verbatim (this is how we see
// WHY invites aren't arriving). Gated by SETUP_TOKEN. Remove after go-live.
export const dynamic = "force-dynamic";

function env(k: string) {
  const v = process.env[k];
  return { present: !!v, len: (v ?? "").length };
}

async function count(fn: () => Promise<number>): Promise<number | string> {
  try {
    return await fn();
  } catch (e) {
    return `ERR: ${e instanceof Error ? e.message.slice(0, 140) : "unknown"}`;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = process.env.SETUP_TOKEN ?? "";
  if (!expected || url.searchParams.get("token") !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Database connectivity + key counts.
  const [
    users, people, coaches, teams, seasons, divisions, facilities,
    registrations, payments, fixtures, messages, acpInterests, waivers,
  ] = await Promise.all([
    count(() => prisma.user.count()),
    count(() => prisma.person.count()),
    count(() => prisma.coach.count()),
    count(() => prisma.team.count()),
    count(() => prisma.season.count()),
    count(() => prisma.division.count()),
    count(() => prisma.facility.count()),
    count(() => prisma.registration.count()),
    count(() => prisma.payment.count()),
    count(() => prisma.fixture.count()),
    count(() => prisma.message.count()),
    count(() => prisma.acpInterest.count()),
    count(() => prisma.waiver.count()),
  ]);

  // Stripe key validity + mode (does not move money — reads balance).
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const stripeMode = stripeKey.startsWith("sk_live_")
    ? "live"
    : stripeKey.startsWith("sk_test_")
    ? "test"
    : stripeKey
    ? "unknown-prefix"
    : "unset";
  let stripe: Record<string, unknown> = { configured: !!stripeKey, mode: stripeMode };
  if (stripeKey) {
    try {
      const res = await fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      stripe = { ...stripe, reachable: true, ok: res.ok, status: res.status };
    } catch (e) {
      stripe = { ...stripe, reachable: false, error: e instanceof Error ? e.message : "err" };
    }
  }

  const pubKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const pubMode = pubKey.startsWith("pk_live_") ? "live" : pubKey.startsWith("pk_test_") ? "test" : pubKey ? "unknown" : "unset";

  // Optional real email send — returns the provider's actual result.
  let emailTest: unknown = "skipped (add &sendTest=1&to=you@example.com to run)";
  if (url.searchParams.get("sendTest") === "1") {
    const to = (url.searchParams.get("to") ?? "").trim();
    emailTest = to
      ? await sendEmail(
          to,
          "PURE Academy — production email test",
          "This is a one-time production smoke-test email. If you received it, outbound email is working.",
        )
      : { ok: false, error: "add &to=you@example.com" };
  }

  return NextResponse.json({
    ok: true,
    db: {
      users, people, coaches, teams, seasons, divisions, facilities,
      registrations, payments, fixtures, messages, acpInterests, waivers,
    },
    // Public / non-secret values shown in full; secrets shown only as present + length.
    config: {
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
      NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV ?? null,
      EMAIL_FROM: process.env.EMAIL_FROM ?? "(unset → default team@purepickleball.com)",
      EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO ?? "(unset → default team@purepickleball.com)",
      stripe,
      publishableKeyMode: pubMode,
      secrets: {
        AUTH_SECRET: env("AUTH_SECRET"),
        DATABASE_URL: env("DATABASE_URL"),
        DIRECT_URL: env("DIRECT_URL"),
        FIELD_ENCRYPTION_KEY: env("FIELD_ENCRYPTION_KEY"),
        STRIPE_SECRET_KEY: env("STRIPE_SECRET_KEY"),
        STRIPE_WEBHOOK_SECRET: env("STRIPE_WEBHOOK_SECRET"),
        RESEND_API_KEY: env("RESEND_API_KEY"),
        BLOB_READ_WRITE_TOKEN: env("BLOB_READ_WRITE_TOKEN"),
        TWILIO_ACCOUNT_SID: env("TWILIO_ACCOUNT_SID"),
        TWILIO_AUTH_TOKEN: env("TWILIO_AUTH_TOKEN"),
        TWILIO_FROM: env("TWILIO_FROM"),
        CRON_SECRET: env("CRON_SECRET"),
        SETUP_TOKEN: env("SETUP_TOKEN"),
      },
    },
    emailTest,
  });
}
