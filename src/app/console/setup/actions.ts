"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { Role } from "@/lib/enums";

const SETUP_ROLES: Role[] = ["COO", "DIRECTOR"];

async function requireSetup() {
  const session = await getSession();
  if (!session || !SETUP_ROLES.includes(session.role)) {
    throw new Error("Not authorized to manage season setup.");
  }
  return session;
}

function toDate(v: FormDataEntryValue | null): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Create a season. If marked active, deactivate other seasons in the same program. */
export async function createSeason(formData: FormData) {
  const session = await requireSetup();
  const name = String(formData.get("name") ?? "").trim();
  const program = String(formData.get("program") ?? "PURE_ACADEMY");
  const startDate = toDate(formData.get("startDate"));
  const endDate = toDate(formData.get("endDate"));
  const opensOn = toDate(formData.get("opensOn"));
  const active = formData.get("active") === "on";

  if (!name || !startDate || !endDate) {
    throw new Error("Name, start date, and end date are required.");
  }

  if (active) {
    await prisma.season.updateMany({ where: { program, active: true }, data: { active: false } });
  }
  const season = await prisma.season.create({
    data: { name, program, startDate, endDate, opensOn, active },
  });
  await audit({
    actorId: session.userId,
    entityType: "Season",
    entityId: season.id,
    action: "season.create",
    summary: `Created season ${name}`,
  });
  revalidatePath("/console/setup");
}

export async function activateSeason(formData: FormData) {
  const session = await requireSetup();
  const id = String(formData.get("seasonId") ?? "");
  const season = await prisma.season.findUnique({ where: { id } });
  if (!season) throw new Error("Season not found.");
  await prisma.season.updateMany({
    where: { program: season.program, active: true },
    data: { active: false },
  });
  await prisma.season.update({ where: { id }, data: { active: true } });
  await audit({
    actorId: session.userId,
    entityType: "Season",
    entityId: id,
    action: "season.activate",
    summary: `Activated ${season.name}`,
  });
  revalidatePath("/console/setup");
}

export async function addDivision(formData: FormData) {
  const session = await requireSetup();
  const seasonId = String(formData.get("seasonId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const divisionType = String(formData.get("divisionType") ?? "DUPR_BAND");
  const minRaw = String(formData.get("minRating") ?? "").trim();
  const maxRaw = String(formData.get("maxRating") ?? "").trim();
  if (!seasonId || !name) throw new Error("Season and division name are required.");

  await prisma.division.create({
    data: {
      seasonId,
      name,
      divisionType,
      minRating: minRaw ? parseFloat(minRaw) : null,
      maxRating: maxRaw ? parseFloat(maxRaw) : null,
    },
  });
  await audit({
    actorId: session.userId,
    entityType: "Division",
    entityId: seasonId,
    action: "division.create",
    summary: `Added division ${name}`,
  });
  revalidatePath("/console/setup");
}

export async function deleteDivision(formData: FormData) {
  const session = await requireSetup();
  const id = String(formData.get("divisionId") ?? "");
  const count = await prisma.registration.count({ where: { divisionId: id } });
  if (count > 0) throw new Error("Can't delete a division that has registrations.");
  await prisma.division.delete({ where: { id } });
  await audit({
    actorId: session.userId,
    entityType: "Division",
    entityId: id,
    action: "division.delete",
  });
  revalidatePath("/console/setup");
}

/** One-click standard PURE Academy divisions (youth school levels + adult DUPR bands). */
export async function addStandardDivisions(formData: FormData) {
  const session = await requireSetup();
  const seasonId = String(formData.get("seasonId") ?? "");
  if (!seasonId) throw new Error("Season is required.");

  const standard: Array<{ name: string; divisionType: string; minRating?: number; maxRating?: number }> = [
    { name: "Youth — Elementary", divisionType: "SCHOOL_LEVEL" },
    { name: "Youth — Middle School", divisionType: "SCHOOL_LEVEL" },
    { name: "Youth — High School", divisionType: "SCHOOL_LEVEL" },
    { name: "Adult 2.5–3.0", divisionType: "DUPR_BAND", minRating: 2.5, maxRating: 3.0 },
    { name: "Adult 3.0–3.5", divisionType: "DUPR_BAND", minRating: 3.0, maxRating: 3.5 },
    { name: "Adult 3.5–4.0", divisionType: "DUPR_BAND", minRating: 3.5, maxRating: 4.0 },
    { name: "Adult 4.0–4.5", divisionType: "DUPR_BAND", minRating: 4.0, maxRating: 4.5 },
    { name: "Adult 4.5+", divisionType: "DUPR_BAND", minRating: 4.5 },
  ];

  const existing = await prisma.division.findMany({ where: { seasonId }, select: { name: true } });
  const have = new Set(existing.map((d) => d.name));
  const toCreate = standard.filter((d) => !have.has(d.name));
  if (toCreate.length) {
    await prisma.division.createMany({
      data: toCreate.map((d) => ({
        seasonId,
        name: d.name,
        divisionType: d.divisionType,
        minRating: d.minRating ?? null,
        maxRating: d.maxRating ?? null,
      })),
    });
  }
  await audit({
    actorId: session.userId,
    entityType: "Division",
    entityId: seasonId,
    action: "division.seed_standard",
    summary: `Added ${toCreate.length} standard divisions`,
  });
  revalidatePath("/console/setup");
}
