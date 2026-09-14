import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { audit } from "@/lib/audit";

// Player/parent portal feedback submission. Saves a Feedback row the office (and,
// if the family chose "Admins and coaches", the named coach) can see, plus an
// optional publish consent and a single photo/video attachment.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/portal/feedback${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return NextResponse.redirect(new URL("/login", origin), 303);

  const me = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { personId: true, person: { select: { firstName: true, lastName: true } } },
  });
  const personId = me?.personId ?? null;

  const body = String(fd.get("body") ?? "").trim();
  if (!body) return back("?err=empty");

  const rawPhase = String(fd.get("phase") ?? "GENERAL");
  const phase = ["MIDSEASON", "ENDSEASON", "GENERAL"].includes(rawPhase) ? rawPhase : "GENERAL";
  const visibility = String(fd.get("visibility") ?? "ADMINS") === "ADMINS_COACHES" ? "ADMINS_COACHES" : "ADMINS";
  const consentPublish = fd.get("consentPublish") === "1";
  const attachmentUrl = String(fd.get("attachmentUrl") ?? "").trim() || null;
  const attachmentType = String(fd.get("attachmentType") ?? "").trim() || null;

  // Only honor a coach id the family actually has (their active-season team
  // coach), so this can't be pointed at an arbitrary coach.
  const rawCoachId = String(fd.get("coachId") ?? "").trim() || null;
  let coachId: string | null = null;
  if (rawCoachId && personId) {
    const household = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, dependents: { select: { id: true } } } });
    const ids = household ? [household.id, ...household.dependents.map((d) => d.id)] : [];
    const ok = ids.length
      ? await prisma.teamMember.findFirst({ where: { personId: { in: ids }, team: { coachId: rawCoachId, season: { active: true } } }, select: { id: true } })
      : null;
    if (ok) coachId = rawCoachId;
  }

  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, orderBy: { startDate: "desc" }, select: { id: true } })
    ?? await prisma.season.findFirst({ where: { active: true }, orderBy: { startDate: "desc" }, select: { id: true } });

  const respondentName = me?.person ? me.person.firstName : null;

  try {
    await prisma.feedback.create({
      data: {
        seasonId: season?.id ?? null,
        personId,
        respondentName,
        coachId,
        body,
        visibility,
        consentPublish,
        attachmentUrl,
        attachmentType,
        phase,
        status: "NEW",
      },
    });
  } catch {
    return back("?err=server");
  }

  await audit({ actorId: actor.userId, entityType: "Feedback", entityId: personId ?? "*", action: "PORTAL_FEEDBACK", summary: `Portal feedback (${visibility}${coachId ? ", about a coach" : ""}${consentPublish ? ", publish OK" : ""})` }).catch(() => {});
  return back("?ok=1");
}
