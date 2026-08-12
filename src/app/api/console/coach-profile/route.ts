import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { COACH_PUBLIC_FIELDS } from "@/lib/domain/coachPublic";

// Coach profile save. Coaches edit their own; admins (manageCoaches) may edit any
// coach by passing a `personId`. A COACH login may not yet have a Coach row
// (accounts are created as Person+User only), so we upsert by personId. Screening
// fields (background check, onboarding) stay admin-only and are never touched here.
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

  // Contact lives on the Person.
  await prisma.person.update({
    where: { id: personId },
    data: { phone: g("phone") || null },
  });

  const markets = list("market").filter(Boolean);
  const bgChecked = g("bgCheck") === "yes";
  const bgDate = g("bgDate");
  const data: Record<string, unknown> = {
    rpoCertLevel: g("rpoCertLevel") || null,
    certifications: g("certifications") || null,
    bio: g("bio") || null,
    coachingLevels: g("coachingLevels") || null,
    marketsCovered: markets.length ? JSON.stringify(markets) : null,
    safeSportCertified: g("safeSport") === "yes",
    backgroundCheckDate: bgChecked && bgDate ? new Date(bgDate) : bgChecked ? new Date() : null,
    backgroundCheckCompany: bgChecked ? (g("bgCompany") || null) : null,
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
