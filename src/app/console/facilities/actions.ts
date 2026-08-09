"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

async function requireFacilityManager() {
  const session = await getSession();
  if (!session || !can(session.role, "manageFacilities")) {
    throw new Error("Not authorized to manage facilities.");
  }
  return session;
}

function dollarsToCents(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

export async function createFacility(formData: FormData) {
  const session = await requireFacilityManager();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Facility name is required.");

  const isPrivate = formData.get("isPrivate") === "on";
  const feeBasis = String(formData.get("feeBasis") ?? "NONE");

  const facility = await prisma.facility.create({
    data: {
      name,
      market: String(formData.get("market") ?? "").trim() || null,
      courtCount: parseInt(String(formData.get("courtCount") ?? "0"), 10) || 0,
      agreementStatus: String(formData.get("agreementStatus") ?? "IDENTIFIED"),
      feeBasis,
      weekdayRateCents: dollarsToCents(formData.get("weekdayRate")),
      weekendRateCents: dollarsToCents(formData.get("weekendRate")),
      percentageRate:
        feeBasis === "PERCENTAGE"
          ? parseFloat(String(formData.get("percentageRate") ?? "0")) || null
          : null,
      primaryContact: String(formData.get("primaryContact") ?? "").trim() || null,
      contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
      contactPhone: String(formData.get("contactPhone") ?? "").trim() || null,
      isPrivate,
      // Private courts expose only a general area publicly; exact address stays behind login (§15).
      generalArea: String(formData.get("generalArea") ?? "").trim() || null,
      exactAddress: String(formData.get("exactAddress") ?? "").trim() || null,
      alaCarteAllowed: formData.get("alaCarteAllowed") === "on",
      acpLeagueOption: formData.get("acpLeagueOption") === "on",
    },
  });

  await audit({
    actorId: session.userId,
    entityType: "Facility",
    entityId: facility.id,
    action: "facility.create",
    summary: `Created facility ${name}`,
  });
  revalidatePath("/console/facilities");
}
