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
        gender: g("gender") || null,
        address: g("address") || null,
        howHeard: g("howHeard") || null,
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
      // Agreeing to the waiver (which certifies guardianship for minors) is the
      // parental consent for a minor registration.
      parentalConsent: isMinor ? waiverSigned : false,
      documentVersion: g("waiverVersion") || "2026-08",
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

  // Ranked location preferences (up to 3) — stored by market/city name.
  const seenMarkets = new Set<string>();
  for (let rank = 1; rank <= 3; rank++) {
    const market = g(`locationPref${rank}`);
    if (market && !seenMarkets.has(market)) {
      seenMarkets.add(market);
      await prisma.locationPreference.create({
        data: { registrationId: registration.id, marketName: market, rank },
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

// A parent/guardian registers multiple children and signs ONE waiver covering
// all of them. Creates the guardian (with an optional portal login), then a
// Person + guardian-signed Waiver + Registration for each child.
export async function familyRegisterAction(
  _prev: RegisterState | undefined,
  formData: FormData
): Promise<RegisterState> {
  const g = (k: string) => String(formData.get(k) ?? "").trim();
  const seasonId = g("seasonId");

  const gFirst = g("guardianFirstName");
  const gLast = g("guardianLastName");
  const gEmail = g("guardianEmail").toLowerCase();
  const signatureName = g("signatureName");
  const waiverSigned = formData.get("waiver") === "on";
  const mediaOptOut = formData.get("mediaOptOut") === "on";

  if (!gFirst || !gLast) return { error: "Parent/guardian name is required." };
  if (!gEmail) return { error: "Parent/guardian email is required." };
  if (!waiverSigned || !signatureName) return { error: "Please read, agree to, and sign the waiver." };

  const firstNames = formData.getAll("childFirstName").map((v) => String(v).trim());
  const lastNames = formData.getAll("childLastName").map((v) => String(v).trim());
  const genders = formData.getAll("childGender").map((v) => String(v).trim());
  const dobs = formData.getAll("childDob").map((v) => String(v).trim());
  const divisionIds = formData.getAll("childDivisionId").map((v) => String(v).trim());

  const kids = firstNames
    .map((fn, i) => ({ firstName: fn, lastName: lastNames[i] ?? "", gender: genders[i] ?? "", dob: dobs[i] ?? "", divisionId: divisionIds[i] ?? "" }))
    .filter((k) => k.firstName && k.lastName);
  if (kids.length === 0) return { error: "Add at least one child (first and last name)." };

  // Guardian person (reuse by email) + optional portal login.
  const guardianAddress = g("guardianAddress") || null;
  const guardianHowHeard = g("guardianHowHeard") || null;
  let guardian = await prisma.person.findFirst({ where: { email: gEmail } });
  if (!guardian) {
    guardian = await prisma.person.create({
      data: {
        firstName: gFirst,
        lastName: gLast,
        email: gEmail,
        phone: g("guardianPhone") || null,
        address: guardianAddress,
        howHeard: guardianHowHeard,
      },
    });
  }
  const password = g("password");
  if (password && !(await prisma.user.findUnique({ where: { email: gEmail } }))) {
    await prisma.user.create({
      data: { email: gEmail, passwordHash: await hashPassword(password), role: "PARENT", personId: guardian.id },
    });
  }

  const markets = [1, 2, 3].map((r) => g(`locationPref${r}`)).filter(Boolean);

  for (const k of kids) {
    const dob = k.dob ? new Date(k.dob) : null;
    const isMinor = dob ? new Date().getFullYear() - dob.getFullYear() < 18 : true;
    const child = await prisma.person.create({
      data: {
        firstName: k.firstName,
        lastName: k.lastName,
        gender: k.gender || null,
        dob,
        isMinor,
        address: guardianAddress,
        howHeard: guardianHowHeard,
        mediaOptOut,
        guardianId: guardian.id,
        waiverSignedAt: new Date(),
      },
    });
    await prisma.waiver.create({
      data: {
        personId: child.id,
        seasonId,
        signedAt: new Date(),
        signatureName,
        mediaConsent: !mediaOptOut,
        parentalConsent: true,
        documentVersion: g("waiverVersion") || "2026-08",
      },
    });
    const registration = await prisma.registration.create({
      data: {
        personId: child.id,
        seasonId,
        divisionId: k.divisionId || null,
        status: "SUBMITTED",
      },
    });
    for (let i = 0; i < markets.length; i++) {
      await prisma.locationPreference.create({
        data: { registrationId: registration.id, marketName: markets[i], rank: i + 1 },
      });
    }
  }

  redirect("/register/thanks");
}
