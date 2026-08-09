import type { PrismaClient } from "@prisma/client";
import { ingestRegistration } from "./intake";
import { parseEnrollments, distinctDivisions } from "./enrollmentImport";

// Shared enrollment-import logic used by BOTH the console route handler and the
// standalone CLI/CI import script, so the two can never drift. Given the CSV
// text it ensures an active PURE Academy season, creates any missing divisions,
// then ingests every row (dedup handled by ingestRegistration).

export const DEFAULT_SEASON = {
  name: "PURE Academy — Fall 2026",
  program: "PURE_ACADEMY",
  startDate: new Date("2026-09-14T00:00:00Z"),
  endDate: new Date("2026-12-13T00:00:00Z"),
};

export type ImportPreview = {
  total: number;
  mapped: number;
  skipped: number;
  child: number;
  divisions: number;
  markets: string[];
};

export type ImportResult = {
  created: number;
  duplicates: number;
  errors: number;
  divisionsAdded: number;
  seasonName: string;
};

export function previewEnrollments(text: string): ImportPreview {
  const { rows, skipped, total } = parseEnrollments(text);
  const divisions = distinctDivisions(rows);
  const markets = [...new Set(rows.flatMap((r) => r.markets))];
  return {
    total,
    mapped: rows.length,
    skipped,
    child: rows.filter((r) => r.isChild).length,
    divisions: divisions.length,
    markets,
  };
}

export async function runEnrollmentImport(
  prisma: PrismaClient,
  text: string
): Promise<ImportResult> {
  const { rows } = parseEnrollments(text);
  if (rows.length === 0) {
    return { created: 0, duplicates: 0, errors: 0, divisionsAdded: 0, seasonName: "" };
  }
  const divisions = distinctDivisions(rows);

  let season = await prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
  });
  if (!season) season = await prisma.season.create({ data: { ...DEFAULT_SEASON, active: true } });

  const existing = await prisma.division.findMany({
    where: { seasonId: season.id },
    select: { name: true },
  });
  const have = new Set(existing.map((d) => d.name.toLowerCase()));
  const toCreate = divisions.filter((d) => !have.has(d.name.toLowerCase()));
  if (toCreate.length) {
    await prisma.division.createMany({
      data: toCreate.map((d) => ({
        seasonId: season!.id,
        name: d.name,
        divisionType: d.type,
        minRating: d.min,
        maxRating: d.max,
      })),
    });
  }

  let created = 0;
  let duplicates = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      const res = await ingestRegistration({
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        phone: r.phone,
        dob: r.dob,
        divisionName: r.divisionName,
        seasonId: season.id,
        practiceTimePref: r.practiceTimePref,
        partnerRequests: r.partnerRequests,
        mediaOptOut: r.mediaOptOut,
        skillLevel: r.minRating ? String(r.minRating) : null,
        waiver: r.waiverSigned
          ? { signed: true, signatureName: r.waiverSignature ?? `${r.firstName} ${r.lastName}` }
          : null,
        emergency: r.emergencyName
          ? { name: r.emergencyName, phone: r.emergencyPhone }
          : null,
        extra: {
          address: r.address,
          gender: r.gender,
          howHeard: r.howHeard,
          stripeCustomerId: r.stripeCustomerId,
          schedule: r.schedule,
          minorNames: r.minorNames,
          perClassRateCents: r.perClassRateCents,
          enrollmentFeeCents: r.enrollmentFeeCents,
          stripeSubscriptionId: r.stripeSubscriptionId,
          stripePaymentMethod: r.stripePaymentMethod,
          sourceStatus: r.sourceStatus,
          importRaw: r.raw,
        },
        locationPrefs: r.markets.map((m, i) => ({ marketName: m, rank: i + 1 })),
        source: "import",
        skipIfRegistered: true,
      }, prisma);
      res.registrationCreated ? created++ : duplicates++;
    } catch {
      errors++;
    }
  }

  return {
    created,
    duplicates,
    errors,
    divisionsAdded: toCreate.length,
    seasonName: season.name,
  };
}
