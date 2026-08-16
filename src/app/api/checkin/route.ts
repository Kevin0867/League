import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCheckinToken } from "@/lib/domain/sessionCheckin";

// A player/parent self-check-in from the texted link. No login: the signed token
// names the (session, player). Marks that player PRESENT for the session and
// bounces back to the confirmation page.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/checkin/${encodeURIComponent(token)}${qs}`, origin), 303);

  const claims = await verifyCheckinToken(token);
  if (!claims) return back("?err=token");

  // The session must exist and still be live (not cancelled). The person must be
  // on one of the session's teams — the token guarantees it, but re-check so a
  // stale token can't write against a roster change.
  const session = await prisma.session.findUnique({
    where: { id: claims.sessionId },
    select: {
      id: true,
      status: true,
      teams: { select: { team: { select: { members: { select: { personId: true } } } } } },
    },
  });
  if (!session) return back("?err=token");
  if (session.status === "CANCELLED") return back("?err=cancelled");
  const onRoster = session.teams.some((st) => st.team.members.some((m) => m.personId === claims.personId));
  if (!onRoster) return back("?err=roster");

  await prisma.attendance.upsert({
    where: { sessionId_personId: { sessionId: claims.sessionId, personId: claims.personId } },
    create: { sessionId: claims.sessionId, personId: claims.personId, status: "PRESENT" },
    update: { status: "PRESENT", markedAt: new Date() },
  });

  return back("?ok=1");
}
