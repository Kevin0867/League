import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, verifyActionTicket } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ingestRegistration } from "@/lib/domain/intake";
import { parseEnrollments, distinctDivisions } from "@/lib/domain/enrollmentImport";

// Enrollment import as a route handler driven by a NATIVE form POST (not fetch):
// on this deployment a fetch upload arrived with no cookies, while native form
// posts (used by login/setup) carry the session reliably. Results are passed
// back via query params to /console/import.
export const dynamic = "force-dynamic";

const DEFAULT_SEASON = {
  name: "PURE Academy — Fall 2026",
  program: "PURE_ACADEMY",
  startDate: new Date("2026-09-14T00:00:00Z"),
  endDate: new Date("2026-12-13T00:00:00Z"),
};

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/import?${qs}`, origin), 303);

  const formData = await req.formData();

  // Authorize off the signed action ticket carried in the form body (the
  // session cookie is not delivered on POSTs here), falling back to the cookie
  // session if it happens to be present.
  const ticket = await verifyActionTicket(
    formData.get("ticket")?.toString(),
    "console.import"
  );
  const session = ticket ?? (await getSession());
  if (!session) return back("err=auth");
  if (!["COO", "DIRECTOR"].includes(session.role)) return back("err=role");
  const actorId = "userId" in session ? session.userId : "";

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return back("err=file");

  const text = await file.text();
  const { rows, skipped, total } = parseEnrollments(text);
  if (rows.length === 0) return back("err=empty");
  const divisions = distinctDivisions(rows);
  const markets = [...new Set(rows.flatMap((r) => r.markets))];

  if (formData.get("mode") !== "commit") {
    const p = new URLSearchParams({
      preview: "1",
      total: String(total),
      mapped: String(rows.length),
      skipped: String(skipped),
      child: String(rows.filter((r) => r.isChild).length),
      divc: String(divisions.length),
      markets: markets.join(","),
    });
    return back(p.toString());
  }

  // --- Commit ---
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
    } catch {
      errors++;
    }
  }

  await audit({
    actorId,
    entityType: "Season",
    entityId: season.id,
    action: "enrollments.import",
    summary: `Imported ${created} new / ${duplicates} duplicate registrations from CSV`,
  });

  const p = new URLSearchParams({
    done: "1",
    created: String(created),
    dup: String(duplicates),
    div: String(toCreate.length),
    err: String(errors),
    season: season.name,
  });
  return back(p.toString());
}
