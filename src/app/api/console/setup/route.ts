import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { audit } from "@/lib/audit";

// Season setup mutations as native-form-POST route handlers with ticket auth.
// Route handlers 303-redirect to a fresh GET (which carries the session cookie),
// so unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth. See /api/console/facilities.
export const dynamic = "force-dynamic";

const SETUP_ROLES = ["COO", "DIRECTOR"];

function toDate(v: FormDataEntryValue | null): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/setup${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor || !SETUP_ROLES.includes(actor.role)) return back("?err=auth");

  const op = String(formData.get("op") ?? "");

  switch (op) {
    case "createSeason": {
      const name = String(formData.get("name") ?? "").trim();
      const program = String(formData.get("program") ?? "PURE_ACADEMY");
      const startDate = toDate(formData.get("startDate"));
      const endDate = toDate(formData.get("endDate"));
      const opensOn = toDate(formData.get("opensOn"));
      const active = formData.get("active") === "on";

      if (!name || !startDate || !endDate) return back("?err=fields");

      if (active) {
        await prisma.season.updateMany({ where: { program, active: true }, data: { active: false } });
      }
      const season = await prisma.season.create({
        data: { name, program, startDate, endDate, opensOn, active },
      });
      await audit({
        actorId: actor.userId,
        entityType: "Season",
        entityId: season.id,
        action: "season.create",
        summary: `Created season ${name}`,
      });
      return back("?ok=createSeason");
    }

    case "activateSeason": {
      const id = String(formData.get("seasonId") ?? "");
      const season = await prisma.season.findUnique({ where: { id } });
      if (!season) return back("?err=notfound");
      await prisma.season.updateMany({
        where: { program: season.program, active: true },
        data: { active: false },
      });
      await prisma.season.update({ where: { id }, data: { active: true } });
      await audit({
        actorId: actor.userId,
        entityType: "Season",
        entityId: id,
        action: "season.activate",
        summary: `Activated ${season.name}`,
      });
      return back("?ok=activateSeason");
    }

    case "addDivision": {
      const seasonId = String(formData.get("seasonId") ?? "");
      const name = String(formData.get("name") ?? "").trim();
      const divisionType = String(formData.get("divisionType") ?? "DUPR_BAND");
      const minRaw = String(formData.get("minRating") ?? "").trim();
      const maxRaw = String(formData.get("maxRating") ?? "").trim();
      if (!seasonId || !name) return back("?err=fields");

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
        actorId: actor.userId,
        entityType: "Division",
        entityId: seasonId,
        action: "division.create",
        summary: `Added division ${name}`,
      });
      return back("?ok=addDivision");
    }

    case "deleteDivision": {
      const id = String(formData.get("divisionId") ?? "");
      const count = await prisma.registration.count({ where: { divisionId: id } });
      if (count > 0) return back("?err=hasregistrations");
      await prisma.division.delete({ where: { id } });
      await audit({
        actorId: actor.userId,
        entityType: "Division",
        entityId: id,
        action: "division.delete",
      });
      return back("?ok=deleteDivision");
    }

    case "addStandardDivisions": {
      const seasonId = String(formData.get("seasonId") ?? "");
      if (!seasonId) return back("?err=season");

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
        actorId: actor.userId,
        entityType: "Division",
        entityId: seasonId,
        action: "division.seed_standard",
        summary: `Added ${toCreate.length} standard divisions`,
      });
      return back("?ok=addStandardDivisions");
    }

    default:
      return back("?err=op");
  }
}
