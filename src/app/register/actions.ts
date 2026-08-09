"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { isLikelyDuplicate } from "@/lib/domain/registrations";

export type RegisterState = { error?: string };

export async function registerAction(
  _prev: RegisterState | undefined,
  formData: FormData
): Promise<RegisterState> {
  const g = (k: string) => String(formData.get(k) ?? "").trim();

  const firstName = g("firstName");
  const lastName = g("lastName");
  const email = g("email").toLowerCase();
  const phone = g("phone");
  const password = g("password");
  const seasonId = g("seasonId");
  const divisionId = g("divisionId") || null;
  const waiverSigned = formData.get("waiver") === "on";
  const signatureName = g("signatureName");

  if (!firstName || !lastName) return { error: "Name is required." };
  if (!email && !phone) return { error: "An email or phone number is required." };
  if (!waiverSigned || !signatureName)
    return { error: "The liability waiver must be signed to register." };
  if (!seasonId) return { error: "No active season is open for registration." };

  // Duplicate detection (§3) — match on name + (email OR phone).
  const candidate = { id: "new", firstName, lastName, email, phone };
  const existingPeople = await prisma.person.findMany({
    where: {
      OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(
        Boolean
      ) as object[],
    },
  });
  const match = existingPeople.find((p) => isLikelyDuplicate(candidate, p));

  const dob = g("dob") ? new Date(g("dob")) : null;
  const isMinor = dob
    ? new Date().getFullYear() - dob.getFullYear() < 18
    : false;
  const mediaOptOut = formData.get("mediaOptOut") === "on";

  let personId: string;
  if (match) {
    // Reuse the existing person; the registration will be flagged for merge review.
    personId = match.id;
    await prisma.person.update({
      where: { id: match.id },
      data: {
        phone: match.phone ?? (phone || null),
        email: match.email ?? (email || null),
        ...(waiverSigned && !match.waiverSignedAt ? { waiverSignedAt: new Date() } : {}),
      },
    });
  } else {
    const person = await prisma.person.create({
      data: {
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        dob,
        isMinor,
        mediaOptOut,
        emergencyName: g("emergencyName") || null,
        emergencyPhone: g("emergencyPhone") || null,
        duprId: g("duprId") || null,
        medicalNotes: g("medical") || null,
        waiverSignedAt: waiverSigned ? new Date() : null,
      },
    });
    personId = person.id;
  }

  // Waiver record with signature date (§3). Media consent is opt-out.
  await prisma.waiver.create({
    data: {
      personId,
      seasonId,
      signedAt: new Date(),
      signatureName,
      mediaConsent: !mediaOptOut,
      parentalConsent: isMinor ? formData.get("parentalConsent") === "on" : false,
      documentVersion: "v1",
    },
  });

  // The registration itself.
  const registration = await prisma.registration.create({
    data: {
      personId,
      seasonId,
      divisionId,
      skillLevel: g("skillLevel") || null,
      duprRatingAtReg: g("duprRating") ? Number(g("duprRating")) : null,
      practiceTimePref: g("practiceTimePref") || null,
      daysThatDontWork: g("daysThatDontWork") || null,
      partnerRequests: g("partnerRequests") || null,
      medicalDisclosures: g("medical") || null,
      mediaOptOut,
      status: match ? "DUPLICATE" : "SUBMITTED",
    },
  });

  // Ranked location preferences (up to 3).
  for (let rank = 1; rank <= 3; rank++) {
    const fid = g(`locationPref${rank}`);
    if (fid) {
      await prisma.locationPreference.create({
        data: { registrationId: registration.id, facilityId: fid, rank },
      });
    }
  }

  // Optional: create a portal login so the family can track placement & pay later.
  if (password && email) {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(password),
          role: "PLAYER",
          personId,
        },
      });
    }
  }

  redirect("/register/thanks");
}
