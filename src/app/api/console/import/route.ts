import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ingestRegistration } from "@/lib/domain/intake";
import { parseEnrollments, distinctDivisions } from "@/lib/domain/enrollmentImport";

// Enrollment import as a ROUTE HANDLER (not a server action): on this runtime,
// server actions — especially multipart/file uploads — don't reliably see the
// session cookie, while route handlers do. Returns the same shapes the form
// renders. mode=preview parses only; mode=commit writes.
export const dynamic = "force-dynamic";

const DEFAULT_SEASON = {
  name: "PURE Academy — Fall 2026",
  program: "PURE_ACADEMY",
  startDate: new Date("2026-09-14T00:00:00Z"),
  endDate: new Date("2026-12-13T00:00:00Z"),
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!["COO", "DIRECTOR"].includes(session.role)) {
    return NextResponse.json({ error: "Importing needs a COO or Director account." }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a CSV file to upload." }, { status: 400 });
  }

  const text = await file.text();
  const { rows, skipped, total } = parseEnrollments(text);
  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid rows found. Is this the enrollment CSV export?" }, { status: 400 });
  }
  const divisions = distinctDivisions(rows);
  const markets = [...new Set(rows.flatMap((r) => r.markets))];

  if (formData.get("mode") !== "commit") {
    return NextResponse.json({
      preview: {
        total,
        mapped: rows.length,
        skipped,
        childCount: rows.filter((r) => r.isChild).length,
        divisions: divisions.map((d) => d.name),
        markets,
      },
    });
  }

  // --- Commit: ensure season + divisions, then ingest each row ---
  let season = await prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
  });
  if (!season) season = await prisma.season.create({ data: { ...DEFAULT_SEASON, active: true } });

  const existing = await prisma.division.findMany({ where: { seasonId: season.id }, select: { name: true } });
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

  let created = 0,
    duplicates = 0,
    errors = 0;
  const sampleErrors: string[] = [];
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
        waiver: r.waiverSigned ? { signed: true, signatureName: `${r.firstName} ${r.lastName}` } : null,
        emergency: r.emergencyName ? { name: r.emergencyName, phone: r.emergencyPhone } : null,
        locationPrefs: r.markets.map((m, i) => ({ marketName: m, rank: i + 1 })),
        source: "import",
      });
      res.duplicate ? duplicates++ : created++;
    } catch (e) {
      errors++;
      if (sampleErrors.length < 5) sampleErrors.push(`${r.firstName} ${r.lastName}: ${(e as Error).message}`);
    }
  }

  await audit({
    actorId: session.userId,
    entityType: "Season",
    entityId: season.id,
    action: "enrollments.import",
    summary: `Imported ${created} new / ${duplicates} duplicate registrations from CSV`,
  });

  return NextResponse.json({
    result: {
      created,
      duplicates,
      errors,
      divisionsEnsured: toCreate.length,
      seasonName: season.name,
      sampleErrors,
    },
  });
}
