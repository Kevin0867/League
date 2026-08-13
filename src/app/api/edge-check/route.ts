// TEMPORARY edge-runtime probe. The login handler (Node runtime) signs the
// session with AUTH_SECRET; the middleware (edge runtime) verifies it with
// AUTH_SECRET. If AUTH_SECRET is visible to Node but NOT to the edge runtime
// (e.g. because it's a Vercel "Sensitive" variable), signing and verifying use
// different secrets and every session is rejected. This reports what the EDGE
// runtime can actually see, with no secret values — just presence and length —
// so we can compare against the Node view. Remove after diagnosis.
export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = process.env.AUTH_SECRET ?? "";
  return Response.json({
    runtime: "edge",
    authSecretPresent: !!process.env.AUTH_SECRET,
    authSecretLen: s.length,
    setupTokenPresent: !!process.env.SETUP_TOKEN,
    nodeEnv: process.env.NODE_ENV ?? null,
  });
}
