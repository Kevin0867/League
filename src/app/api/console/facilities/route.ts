import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Facility create as a native-form-POST route handler with ticket auth. Route
// handlers 303-redirect to a fresh GET (which carries the session cookie), so
// unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth. See /api/console/import.
export const dynamic = "force-dynamic";

function dollarsToCents(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/facilities${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageFacilities")) return back("?err=auth");

  const op = String(formData.get("op") ?? "create");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return back("?err=name");

  const feeBasis = String(formData.get("feeBasis") ?? "NONE");
  const isPrivate = formData.get("isPrivate") === "on";
  const percentageRate =
    feeBasis === "PERCENTAGE"
      ? (parseFloat(String(formData.get("percentageRate") ?? "0")) || 0) / 100 || null
      : null;

  const data = {
    name,
    market: String(formData.get("market") ?? "").trim() || null,
    courtCount: parseInt(String(formData.get("courtCount") ?? "0"), 10) || 0,
    agreementStatus: String(formData.get("agreementStatus") ?? "IDENTIFIED"),
    feeBasis,
    weekdayRateCents: dollarsToCents(formData.get("weekdayRate")),
    weekendRateCents: dollarsToCents(formData.get("weekendRate")),
    percentageRate,
    primaryContact: String(formData.get("primaryContact") ?? "").trim() || null,
    contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
    contactPhone: String(formData.get("contactPhone") ?? "").trim() || null,
    isPrivate,
    generalArea: String(formData.get("generalArea") ?? "").trim() || null,
    exactAddress: String(formData.get("exactAddress") ?? "").trim() || null,
    alaCarteAllowed: formData.get("alaCarteAllowed") === "on",
    acpLeagueOption: formData.get("acpLeagueOption") === "on",
  };

  if (op === "edit") {
    const facilityId = String(formData.get("facilityId") ?? "");
    if (!facilityId) return back("?err=name");
    await prisma.facility.update({ where: { id: facilityId }, data });
    await audit({ actorId: actor.userId, entityType: "Facility", entityId: facilityId, action: "facility.update", summary: `Edited facility ${name}` });
    return back("?ok=edited");
  }

  const facility = await prisma.facility.create({ data });
  await audit({ actorId: actor.userId, entityType: "Facility", entityId: facility.id, action: "facility.create", summary: `Created facility ${name}` });
  return back("?added=1");
}
