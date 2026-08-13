import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { COACH_PUBLIC_FIELDS } from "@/lib/domain/coachPublic";

// Coach profile save. Coaches edit their own; admins (manageCoaches) may edit any
// coach by passing a `personId`. A COACH login may not yet have a Coach row
// (accounts are created as Person+User only), so we upsert by personId. Screening
// fields (background check + curriculum onboarding) are set from the Screening &
// compliance section and gate whether a coach can be assigned to a team.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor) return NextResponse.redirect(new URL("/login", origin), 303);

  // An admin may edit another coach by supplying their personId; otherwise the
  // caller edits their own profile.
  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const list = (k: string) => fd.getAll(k).map((v) => String(v).trim());

  const targetPersonId = g("personId");
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  const editingOther = !!targetPersonId && targetPersonId !== me?.personId;
  if (editingOther && !can(actor.role, "manageCoaches")) {
    return NextResponse.redirect(new URL("/console/coaches?err=auth", origin), 303);
  }
  const personId = editingOther ? targetPersonId : me?.personId ?? "";
  const returnBase = editingOther ? "/console/coaches" : "/console/profile";
  const back = (qs: string) => NextResponse.redirect(new URL(`${returnBase}${qs}`, origin), 303);

  if (!personId) return back("?err=noperson");

  // Contact lives on the Person. Name + email are editable only in the admin
  // context (manageCoaches) — a coach editing their own profile can't rename
  // themselves or change their login email here.
  const identityEditable = can(actor.role, "manageCoaches") && fd.has("firstName");
  const personData: Record<string, unknown> = { phone: g("phone") || null };
  let newEmail = "";
  if (identityEditable) {
    if (g("firstName")) personData.firstName = g("firstName");
    if (g("lastName")) personData.lastName = g("lastName");
    newEmail = g("email").toLowerCase();
    if (newEmail) personData.email = newEmail;
  }
  await prisma.person.update({ where: { id: personId }, data: personData });

  // Keep the login email in sync when an admin changes it — but never clobber
  // another account's email (skip silently if it's taken).
  if (identityEditable && newEmail) {
    const user = await prisma.user.findFirst({ where: { personId }, select: { id: true, email: true } });
    if (user && user.email.toLowerCase() !== newEmail) {
      const clash = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
      if (!clash) await prisma.user.update({ where: { id: user.id }, data: { email: newEmail } });
    }
  }

  const markets = list("market").filter(Boolean);
  const bgChecked = g("bgCheck") === "yes";
  const bgDate = g("bgDate");
  // Preserve the original onboarding-completion timestamp; only stamp "now" the
  // first time it's marked complete, and clear it if unset.
  const existing = await prisma.coach.findUnique({ where: { personId }, select: { onboardingCompletedAt: true } });
  const data: Record<string, unknown> = {
    rpoCertLevel: g("rpoCertLevel") || null,
    certifications: g("certifications") || null,
    bio: g("bio") || null,
    coachingLevels: g("coachingLevels") || null,
    marketsCovered: markets.length ? JSON.stringify(markets) : null,
    safeSportCertified: g("safeSport") === "yes",
    backgroundCheckDate: bgChecked && bgDate ? new Date(bgDate) : bgChecked ? new Date() : null,
    backgroundCheckCompany: bgChecked ? (g("bgCompany") || null) : null,
    onboardingCompletedAt: g("onboarding") === "yes" ? (existing?.onboardingCompletedAt ?? new Date()) : null,
    // Public-profile visibility: the form submits the fields to SHOW; anything
    // not checked is hidden. Only written when the visibility section rendered.
    ...(g("pubVisible") === "1"
      ? { publicHidden: COACH_PUBLIC_FIELDS.map((f) => f.key).filter((k) => !list("pubShow").includes(k)) }
      : {}),
  };

  // Compensation is admin-only. It is written only when the form was rendered
  // with the pay section (payVisible=1) AND the actor may manage coaches — so a
  // coach editing their own profile (where the section isn't shown) can neither
  // see nor clear it, and can't inject pay by hand-posting the fields.
  if (g("payVisible") === "1" && can(actor.role, "manageCoaches")) {
    const cents = (k: string) => {
      const n = parseFloat(g(k));
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
    };
    const pct = (k: string) => {
      const n = parseInt(g(k), 10);
      return Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : null;
    };
    data.seasonPayCents = cents("seasonRate");
    data.seasonPayPct = pct("seasonPct");
    data.lessonPayCents = cents("lessonRate");
    data.lessonPayPct = pct("lessonPct");
    data.clinicPayCents = cents("clinicRate");
    data.clinicPayPct = pct("clinicPct");
    data.payNotes = g("payNotes") || null;
  }
  const coach = await prisma.coach.upsert({
    where: { personId },
    create: { personId, ...data },
    update: data,
  });

  // Day/time availability — replace the full set from the submitted rows.
  const days = list("availDay");
  const starts = list("availStart");
  const ends = list("availEnd");
  await prisma.availabilityBlock.deleteMany({ where: { coachId: coach.id } });
  for (let i = 0; i < days.length; i++) {
    if (days[i] && starts[i] && ends[i]) {
      await prisma.availabilityBlock.create({
        data: { coachId: coach.id, dayOfWeek: days[i], startTime: starts[i], endTime: ends[i] },
      });
    }
  }

  await audit({
    actorId: actor.userId,
    entityType: "Coach",
    entityId: coach.id,
    action: "coach.profile.update",
    summary: editingOther ? "Admin updated coach profile" : "Coach updated their profile",
  });
  return back(editingOther ? "?ok=profile" : "?ok=1");
}
