import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { isSessionComplete } from "@/lib/domain/coachPay";

// Per-player attendance save for the courtside marker — one tap, saved
// immediately, JSON back (no redirect) so the roster never reloads mid-class.
// The bulk form op in /api/console/schedule stays as an offline fallback.
export const dynamic = "force-dynamic";

const VALID = new Set(["PRESENT", "ABSENT", "EXCUSED"]);

export async function POST(req: Request) {
  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "markAttendance")) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 403 });
  }
  const sessionId = String(fd.get("sessionId") ?? "");
  const personId = String(fd.get("personId") ?? "");
  const status = String(fd.get("status") ?? "");
  if (!sessionId || !personId || !VALID.has(status)) {
    return NextResponse.json({ ok: false, error: "bad" }, { status: 400 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      date: true, endTime: true, status: true,
      teams: { select: { team: { select: { members: { select: { personId: true } } } } } },
    },
  });
  if (!session) return NextResponse.json({ ok: false, error: "notfound" }, { status: 404 });

  // The player must be on this session's roster.
  const onRoster = session.teams.some((t) => t.team.members.some((m) => m.personId === personId));
  if (!onRoster) return NextResponse.json({ ok: false, error: "notmember" }, { status: 400 });

  await prisma.attendance.upsert({
    where: { sessionId_personId: { sessionId, personId } },
    create: { sessionId, personId, status },
    update: { status },
  });

  // Recording attendance on a class that's actually over marks it delivered.
  if (session.status === "SCHEDULED" && isSessionComplete({ date: session.date, endTime: session.endTime, status: session.status })) {
    await prisma.session.update({ where: { id: sessionId }, data: { status: "DELIVERED" } });
  }

  await audit({ actorId: actor.userId, entityType: "Session", entityId: sessionId, action: "ATTENDANCE", summary: `Marked ${status.toLowerCase()} for 1 player` });
  return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
}
