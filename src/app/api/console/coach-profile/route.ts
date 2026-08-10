import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

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
  const data = {
    rpoCertLevel: g("rpoCertLevel") || null,
    certifications: g("certifications") || null,
    bio: g("bio") || null,
    coachingLevels: g("coachingLevels") || null,
    marketsCovered: markets.length ? JSON.stringify(markets) : null,
  };
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
