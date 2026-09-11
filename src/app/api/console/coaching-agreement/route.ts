import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { sendEmail, sendSms } from "@/lib/notify";
import { appUrl } from "@/lib/stripe";
import { coachAssignmentForAgreement, CREDENTIAL_FIELDS, type AgreementCredentials } from "@/lib/domain/coachingAgreement";
import { ADMIN_ROLES } from "@/lib/enums";

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
    // Collect the coach-entered credentials; require the mandatory ones.
    const credentials: AgreementCredentials = {};
    for (const f of CREDENTIAL_FIELDS) {
      const v = String(fd.get(`cred_${f.key}`) ?? "").trim();
      if (v) credentials[f.key] = v;
    }
    const missingRequired = CREDENTIAL_FIELDS.some((f) => f.required && !credentials[f.key]);
    if (!agree || !signature || missingRequired) return back(`${rt}?err=agree`);

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
      credentials: credentials as unknown as Prisma.InputJsonValue,
      coachName,
      coachEmail: coach.person.email,
      coachPhone: coach.person.phone,
      coachSignature: signature,
      coachSignedAt: new Date(),
      adminNote: null, // clear any prior return-for-correction note on re-sign
    };
    const rec = existing
      ? await prisma.coachingAgreement.update({ where: { id: existing.id }, data })
      : await prisma.coachingAgreement.create({ data: { coachId: coach.id, seasonId: season?.id ?? null, ...data } });

    await audit({ actorId: actor.userId, entityType: "CoachingAgreement", entityId: rec.id, action: "COACH_SIGNED", summary: `${coachName} signed their coaching agreement` });

    // Email the team inbox so an admin can countersign.
    try {
      const link = `${appUrl()}/console/agreements/${rec.id}`;
      const teamLines = assignment.teams.map((t) => `  • ${t.team} (${t.role}) — ${t.dayTime} — ${t.location}`);
      const credLines = CREDENTIAL_FIELDS.filter((f) => credentials[f.key]).map((f) => `  • ${f.label}: ${credentials[f.key]}`);
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
          "Credentials & screening (verify before countersigning):",
          ...(credLines.length ? credLines : ["  (none entered)"]),
          "",
          `Verify and countersign here: ${link}`,
        ].filter(Boolean).join("\n"),
      );
    } catch (e) {
      console.error("agreement team email failed", e);
    }
    // Notify every admin directly — by email AND text — so a signed agreement
    // awaiting countersignature is never missed.
    try {
      const link = `${appUrl()}/console/agreements/${rec.id}`;
      const admins = await prisma.user.findMany({
        where: { active: true, role: { in: ADMIN_ROLES as unknown as string[] } },
        select: { person: { select: { email: true, phone: true } } },
      });
      const seen = new Set<string>();
      for (const a of admins) {
        const p = a.person;
        if (p?.email && !seen.has(`e:${p.email}`)) {
          seen.add(`e:${p.email}`);
          await sendEmail(p.email, `Coaching agreement signed — ${coachName} (needs countersignature)`, `${coachName} signed their PURE coaching agreement. Verify their credentials and countersign here: ${link}`).catch(() => {});
        }
        if (p?.phone && !seen.has(`s:${p.phone}`)) {
          seen.add(`s:${p.phone}`);
          await sendSms(p.phone, `PURE Academy — ${coachName} signed their coaching agreement and it needs your countersignature: ${link}`).catch(() => {});
        }
      }
    } catch (e) {
      console.error("agreement admin notify failed", e);
    }
    return back(`${rt}?ok=signed`);
  }

  if (op === "adminCountersign") {
    if (!can(actor.role, "manageCoaches")) return back("/console/agreements?err=auth");
    const id = String(fd.get("agreementId") ?? "").trim();
    const adminName = String(fd.get("adminName") ?? "").trim();
    const adminTitle = String(fd.get("adminTitle") ?? "").trim();
    const signature = String(fd.get("signature") ?? "").trim();
    const verified = fd.get("verified") === "1";
    if (!id || !signature || !adminName) return back(`/console/agreements/${id}?err=fields`);
    if (!verified) return back(`/console/agreements/${id}?err=verify`);
    const rec = await prisma.coachingAgreement.findUnique({ where: { id }, select: { id: true, status: true, coachName: true, coachEmail: true } });
    if (!rec) return back("/console/agreements?err=notfound");
    if (rec.status !== "COACH_SIGNED") return back(`/console/agreements/${id}?err=state`);
    await prisma.coachingAgreement.update({
      where: { id },
      data: { status: "COUNTERSIGNED", adminName, adminTitle: adminTitle || null, adminSignedById: actor.userId, adminSignedAt: new Date(), adminNote: null },
    });
    await audit({ actorId: actor.userId, entityType: "CoachingAgreement", entityId: id, action: "COUNTERSIGNED", summary: `${adminName} verified credentials and countersigned ${rec.coachName ?? "coach"}'s agreement` });
    // Let the coach know it's fully executed (their copy is on their account).
    try {
      if (rec.coachEmail) {
        await sendEmail(rec.coachEmail, "Your PURE coaching agreement is fully executed", `Your coaching agreement has been countersigned by PURE and is now fully executed. A copy is on your account: ${appUrl()}/console/agreement`);
      }
    } catch (e) { console.error("agreement coach email failed", e); }
    return back(`/console/agreements/${id}?ok=countersigned`);
  }

  if (op === "returnForCorrection") {
    if (!can(actor.role, "manageCoaches")) return back("/console/agreements?err=auth");
    const id = String(fd.get("agreementId") ?? "").trim();
    const note = String(fd.get("note") ?? "").trim();
    if (!id || !note) return back(`/console/agreements/${id}?err=note`);
    const rec = await prisma.coachingAgreement.findUnique({ where: { id }, select: { id: true, status: true, coachName: true, coachEmail: true, coachPhone: true } });
    if (!rec) return back("/console/agreements?err=notfound");
    if (rec.status !== "COACH_SIGNED") return back(`/console/agreements/${id}?err=state`);
    // Reset to unsigned so the coach must redo it with the correct info; keep the
    // credentials they entered so they only fix what's wrong.
    await prisma.coachingAgreement.update({
      where: { id },
      data: { status: "SENT", coachSignature: null, coachSignedAt: null, adminNote: note },
    });
    await audit({ actorId: actor.userId, entityType: "CoachingAgreement", entityId: id, action: "RETURNED_FOR_CORRECTION", summary: `Returned ${rec.coachName ?? "coach"}'s agreement for correction` });
    // Notify the coach by email AND text so they know to fix it. Their console
    // also flags "Needs attention" on the agreement until they re-sign.
    const link = `${appUrl()}/console/agreement`;
    try {
      if (rec.coachEmail) {
        await sendEmail(
          rec.coachEmail,
          "Your PURE coaching agreement needs correction",
          [
            "PURE reviewed your coaching agreement and it needs to be redone with the correct information:",
            "",
            note,
            "",
            `Please fix the details and sign again: ${link}`,
          ].join("\n"),
        );
      }
    } catch (e) { console.error("agreement return email failed", e); }
    try {
      if (rec.coachPhone) {
        await sendSms(rec.coachPhone, `Your PURE coaching agreement needs correction: ${note} Fix & re-sign: ${link}`);
      }
    } catch (e) { console.error("agreement return sms failed", e); }
    return back(`/console/agreements/${id}?ok=returned`);
  }

  return back("/console/agreements?err=op");
}
