import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { coachAssignmentForAgreement } from "@/lib/domain/coachingAgreement";

// Digital coaching-agreement signing. A coach signs (op=coachSign) → the record
// is created/updated as COACH_SIGNED and emailed to the team inbox for an admin
// to countersign (op=adminCountersign) → COUNTERSIGNED. The signed copy is
// retained and shown in both the coach's and admins' views.
export const dynamic = "force-dynamic";

const TEAM_INBOX = process.env.TEAM_INBOX_EMAIL ?? "team@purepickleball.com";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const op = String(fd.get("op") ?? "");
  const rawReturn = String(fd.get("returnTo") ?? "");
  const back = (path: string) => NextResponse.redirect(new URL(path, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("/login");

  if (op === "coachSign") {
    const rt = rawReturn.startsWith("/console/") ? rawReturn : "/console/agreement";
    const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
    const coach = me?.personId
      ? await prisma.coach.findUnique({ where: { personId: me.personId }, select: { id: true, person: { select: { firstName: true, lastName: true, email: true, phone: true } } } })
      : null;
    if (!coach) return back(`${rt}?err=nocoach`);
    const agree = fd.get("agree") === "1";
    const signature = String(fd.get("signature") ?? "").trim();
    if (!agree || !signature) return back(`${rt}?err=agree`);

    const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })
      ?? await prisma.season.findFirst({ where: { active: true }, select: { id: true } });
    const assignment = await coachAssignmentForAgreement(coach.id);
    const coachName = `${coach.person.firstName} ${coach.person.lastName}`.trim();

    // Reuse the season's record if one exists (re-sign), else create it.
    const existing = await prisma.coachingAgreement.findFirst({
      where: { coachId: coach.id, ...(season ? { seasonId: season.id } : {}) },
      orderBy: { createdAt: "desc" },
    });
    const data = {
      status: "COACH_SIGNED",
      assignment: assignment as unknown as Prisma.InputJsonValue,
      coachName,
      coachEmail: coach.person.email,
      coachPhone: coach.person.phone,
      coachSignature: signature,
      coachSignedAt: new Date(),
    };
    const rec = existing
      ? await prisma.coachingAgreement.update({ where: { id: existing.id }, data })
      : await prisma.coachingAgreement.create({ data: { coachId: coach.id, seasonId: season?.id ?? null, ...data } });

    await audit({ actorId: actor.userId, entityType: "CoachingAgreement", entityId: rec.id, action: "COACH_SIGNED", summary: `${coachName} signed their coaching agreement` });

    // Email the team inbox so an admin can countersign.
    try {
      const link = `${appUrl()}/console/agreements/${rec.id}`;
      const teamLines = assignment.teams.map((t) => `  • ${t.team} (${t.role}) — ${t.dayTime} — ${t.location}`);
      await sendEmail(
        TEAM_INBOX,
        `Coaching agreement signed — ${coachName} (needs countersignature)`,
        [
          `${coachName} has signed their PURE coaching agreement.`,
          coach.person.email || coach.person.phone ? `Contact: ${[coach.person.email, coach.person.phone].filter(Boolean).join(" · ")}` : "",
          "",
          "Assignment:",
          ...(teamLines.length ? teamLines : ["  (no teams assigned yet)"]),
          "",
          `Countersign here: ${link}`,
        ].filter(Boolean).join("\n"),
      );
    } catch (e) {
      console.error("agreement team email failed", e);
    }
    return back(`${rt}?ok=signed`);
  }

  if (op === "adminCountersign") {
    if (!can(actor.role, "manageCoaches")) return back("/console/agreements?err=auth");
    const id = String(fd.get("agreementId") ?? "").trim();
    const adminName = String(fd.get("adminName") ?? "").trim();
    const adminTitle = String(fd.get("adminTitle") ?? "").trim();
    const signature = String(fd.get("signature") ?? "").trim();
    if (!id || !signature || !adminName) return back(`/console/agreements/${id}?err=fields`);
    const rec = await prisma.coachingAgreement.findUnique({ where: { id }, select: { id: true, status: true, coachName: true, coachEmail: true } });
    if (!rec) return back("/console/agreements?err=notfound");
    if (rec.status !== "COACH_SIGNED") return back(`/console/agreements/${id}?err=state`);
    await prisma.coachingAgreement.update({
      where: { id },
      data: { status: "COUNTERSIGNED", adminName, adminTitle: adminTitle || null, adminSignedById: actor.userId, adminSignedAt: new Date() },
    });
    await audit({ actorId: actor.userId, entityType: "CoachingAgreement", entityId: id, action: "COUNTERSIGNED", summary: `${adminName} countersigned ${rec.coachName ?? "coach"}'s agreement` });
    // Let the coach know it's fully executed (their copy is on their account).
    try {
      if (rec.coachEmail) {
        await sendEmail(rec.coachEmail, "Your PURE coaching agreement is fully executed", `Your coaching agreement has been countersigned by PURE and is now fully executed. A copy is on your account: ${appUrl()}/console/agreement`);
      }
    } catch (e) { console.error("agreement coach email failed", e); }
    return back(`/console/agreements/${id}?ok=countersigned`);
  }

  return back("/console/agreements?err=op");
}
