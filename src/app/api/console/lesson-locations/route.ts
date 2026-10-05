import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Lesson-specific locations: facilities flagged for private/group lessons
// (alaCarteAllowed), managed from the lessons area. Only touches the fields that
// matter for lessons — name, area, court count, the court contact (who PURE
// emails to reserve a court), and the weekly AVAILABLE hours — so it never wipes
// the fee/agreement data a shared Academy facility may also carry.
export const dynamic = "force-dynamic";

const DAYS = new Set(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/profile/lessons/locations${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");

  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const op = g("op");

  if (op === "remove") {
    const id = g("facilityId");
    if (!id) return back("?err=missing");
    // Don't delete the facility (it may be used elsewhere) — just drop it from lessons.
    await prisma.facility.update({ where: { id }, data: { alaCarteAllowed: false } }).catch(() => {});
    await audit({ actorId: actor.userId, entityType: "Facility", entityId: id, action: "facility.lesson.remove", summary: "Removed facility from lesson locations" });
    return back("?ok=removed");
  }

  const name = g("name");
  if (!name) return back("?err=name");
  const data = {
    name,
    generalArea: g("generalArea") || null,
    courtCount: parseInt(g("courtCount") || "0", 10) || 0,
    primaryContact: g("primaryContact") || null,
    contactEmail: g("contactEmail") || null,
    contactPhone: g("contactPhone") || null,
    alaCarteAllowed: true,
  };
  if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) return back("?err=email");

  // Weekly AVAILABLE hours from the repeater rows (validated).
  const days = fd.getAll("availDay").map(String);
  const starts = fd.getAll("availStart").map(String);
  const ends = fd.getAll("availEnd").map(String);
  const courts = fd.getAll("availCourts").map(String);
  const toMin = (t: string) => { const [h, m] = (t || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const blocks: { dayOfWeek: string; startTime: string; endTime: string; courtCount: number; kind: string }[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i].trim().toUpperCase(), s = (starts[i] ?? "").trim(), e = (ends[i] ?? "").trim();
    if (!d || !s || !e) continue;
    if (!DAYS.has(d)) return back("?err=day");
    if (toMin(e) <= toMin(s)) return back("?err=hours");
    blocks.push({ dayOfWeek: d, startTime: s, endTime: e, courtCount: parseInt(courts[i] ?? "1", 10) || 1, kind: "AVAILABLE" });
  }

  const id = g("facilityId");
  if (id) {
    await prisma.facility.update({ where: { id }, data });
    // Replace only the AVAILABLE windows — preserve any BLOCKED windows.
    await prisma.courtBlock.deleteMany({ where: { facilityId: id, kind: "AVAILABLE" } });
    if (blocks.length) await prisma.courtBlock.createMany({ data: blocks.map((b) => ({ ...b, facilityId: id })) });
    await audit({ actorId: actor.userId, entityType: "Facility", entityId: id, action: "facility.lesson.edit", summary: `Edited lesson location ${name}` });
    return back("?ok=saved");
  }

  const fac = await prisma.facility.create({ data });
  if (blocks.length) await prisma.courtBlock.createMany({ data: blocks.map((b) => ({ ...b, facilityId: fac.id })) });
  await audit({ actorId: actor.userId, entityType: "Facility", entityId: fac.id, action: "facility.lesson.create", summary: `Created lesson location ${name}` });
  return back("?ok=added");
}
