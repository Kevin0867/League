import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";

// TEMPORARY production diagnostic. Reports cookie/session state and sets a test
// cookie so a refresh reveals whether app cookies survive the round-trip.
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const token = jar.get("pa_session")?.value;
  const testSeen = jar.get("pa_test")?.value ?? null;
  let session = null;
  try {
    session = await getSession();
  } catch {
    /* ignore */
  }
  const res = NextResponse.json({
    nodeEnv: process.env.NODE_ENV ?? null,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
    dbConfigured: !!process.env.DATABASE_URL,
    cookieReceived: !!token,
    testCookieSeen: testSeen,
    cookieNames: jar.getAll().map((c) => c.name),
    sessionResolved: !!session,
    role: session?.role ?? null,
    build: "prod-diag-1",
  });
  res.cookies.set("pa_test", "ok", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
