import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";

// TEMPORARY diagnostic — reports what the server sees for the session cookie.
// No secrets are exposed (only booleans + the caller's own role/email).
// Remove once the auth issue is resolved.
export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const token = jar.get("pa_session")?.value;
  let session = null;
  try {
    session = await getSession();
  } catch {
    /* ignore */
  }
  return NextResponse.json({
    nodeEnv: process.env.NODE_ENV ?? null,
    authSecretSet: !!process.env.AUTH_SECRET,
    cookieReceived: !!token,
    tokenLength: token?.length ?? 0,
    cookieNames: jar.getAll().map((c) => c.name),
    sessionResolved: !!session,
    role: session?.role ?? null,
  });
}
