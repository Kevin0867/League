import "server-only";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { isLikelyDuplicate } from "./registrations";

// Registration intake — the single code path for creating a player record,
// shared by the public /register form and the external intake API. Runs the
// duplicate-detection + merge rules (§3) so signups flow in automatically and
// cleanly, from either source. Sensitive fields are encrypted at rest by the
// Prisma client extension.

export type IntakeInput = {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  dob?: string | null; // ISO date
  skillLevel?: string | null;
  duprId?: string | null;
  duprRating?: number | null;
  practiceTimePref?: string | null;
  daysThatDontWork?: string | null;
  partnerRequests?: string | null;
  medicalDisclosures?: string | null;
  mediaOptOut?: boolean;
  emergency?: { name?: string | null; phone?: string | null; relation?: string | null } | null;
  isCoachRegistration?: boolean;
  /**
   * When true, if the resolved person already has a registration in the same
   * season + division, return that one instead of creating a duplicate. Used by
   * the bulk importer so it is idempotent (safe to re-run, and collapses
   * repeat submissions within the same file). Off by default so the public
   * /register form and intake API keep recording every submission.
   */
  skipIfRegistered?: boolean;
  waiver?: { signed?: boolean; signatureName?: string | null; parentalConsent?: boolean } | null;
  seasonId?: string | null;
  seasonName?: string | null;
  divisionId?: string | null;
  divisionName?: string | null;
  locationPrefs?: Array<{ facilityId?: string | null; facilityName?: string | null; marketName?: string | null; rank?: number }>;
  source?: string; // "web-form" | "api" | "import" | ...
  /**
   * Additional enrollment-intake fields captured from the source CSV. Person
   * fields backfill an existing person; registration fields are written on
   * create and backfilled onto an existing registration on re-import.
   */
  extra?: {
    // Person
    address?: string | null;
    gender?: string | null;
    howHeard?: string | null;
    stripeCustomerId?: string | null;
    // Registration
    schedule?: string | null;
    minorNames?: string | null;
    perClassRateCents?: number | null;
    enrollmentFeeCents?: number | null;
    stripeSubscriptionId?: string | null;
    stripePaymentMethod?: string | null;
    sourceStatus?: string | null;
    importRaw?: unknown;
  };
};

export type IntakeResult = {
  personId: string;
  registrationId: string;
  status: string;
  /** True when the resolved person already existed (matched a prior record). */
  duplicate: boolean;
  /** False when an existing registration was reused (skipIfRegistered). */
  registrationCreated: boolean;
};

function computeIsMinor(dob: Date | null): boolean {
  if (!dob) return false;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age < 18;
}

export async function ingestRegistration(
  input: IntakeInput,
  // The Prisma client to write with. Defaults to the encryption-extended
  // singleton (so the web form / API encrypt sensitive fields with the app's
  // key). The bulk importer may pass a plain client when it runs outside the
  // app (e.g. CI) and cannot access the app's encryption key — those fields are
  // then stored as plaintext, which the app reads via its legacy-plaintext path.
  db: PrismaClient = prisma as unknown as PrismaClient
): Promise<IntakeResult> {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  const email = input.email?.toLowerCase().trim() || null;
  const phone = input.phone?.trim() || null;

  if (!firstName || !lastName) throw new Error("First and last name are required.");
  if (!email && !phone) throw new Error("An email or phone number is required.");

  // Resolve the season (default: active PURE Academy season).
  const season = input.seasonId
    ? await db.season.findUnique({ where: { id: input.seasonId } })
    : input.seasonName
    ? await db.season.findFirst({ where: { name: input.seasonName } })
    : await db.season.findFirst({
        where: { active: true, program: "PURE_ACADEMY" },
        orderBy: { startDate: "desc" },
      });
  if (!season) throw new Error("No active season is open for registration.");

  // Resolve division by id or name.
  let divisionId = input.divisionId ?? null;
  if (!divisionId && input.divisionName) {
    const div = await db.division.findFirst({
      where: { seasonId: season.id, name: { equals: input.divisionName, mode: "insensitive" } },
    });
    divisionId = div?.id ?? null;
  }

  const dob = input.dob ? new Date(input.dob) : null;
  const isMinor = computeIsMinor(dob);
  const mediaOptOut = !!input.mediaOptOut;
  const waiverSigned = !!input.waiver?.signed;
  const x = input.extra ?? {};

  // Registration-level intake fields, written on create and backfilled on
  // re-import. `undefined` values are stripped so we never clobber with null.
  const regExtra = Object.fromEntries(
    Object.entries({
      schedule: x.schedule ?? undefined,
      minorNames: x.minorNames ?? undefined,
      perClassRateCents: x.perClassRateCents ?? undefined,
      enrollmentFeeCents: x.enrollmentFeeCents ?? undefined,
      stripeSubscriptionId: x.stripeSubscriptionId ?? undefined,
      stripePaymentMethod: x.stripePaymentMethod ?? undefined,
      sourceStatus: x.sourceStatus ?? undefined,
      importRaw: x.importRaw ?? undefined,
    }).filter(([, v]) => v !== undefined)
  ) as Record<string, unknown>;

  // Duplicate detection — match on name + (email OR phone) (§3).
  const candidate = { id: "new", firstName, lastName, email, phone };
  const existing = await db.person.findMany({
    where: {
      OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as object[],
    },
  });
  const match = existing.find((p) => isLikelyDuplicate(candidate, p));

  let personId: string;
  if (match) {
    // Reuse the surviving record; fill gaps but don't overwrite existing values.
    personId = match.id;
    await db.person.update({
      where: { id: match.id },
      data: {
        email: match.email ?? email,
        phone: match.phone ?? phone,
        duprId: match.duprId ?? input.duprId ?? null,
        duprRating: match.duprRating ?? input.duprRating ?? null,
        ...(waiverSigned && !match.waiverSignedAt ? { waiverSignedAt: new Date() } : {}),
        ...(input.emergency?.name ? { emergencyName: input.emergency.name } : {}),
        ...(input.emergency?.phone ? { emergencyPhone: input.emergency.phone } : {}),
        ...(input.emergency?.relation ? { emergencyRelation: input.emergency.relation } : {}),
        ...(input.medicalDisclosures ? { medicalNotes: input.medicalDisclosures } : {}),
        // Backfill demographic/intake fields only where the person has none.
        ...(!match.address && x.address ? { address: x.address } : {}),
        ...(!match.gender && x.gender ? { gender: x.gender } : {}),
        ...(!match.howHeard && x.howHeard ? { howHeard: x.howHeard } : {}),
        ...(!match.stripeCustomerId && x.stripeCustomerId ? { stripeCustomerId: x.stripeCustomerId } : {}),
      },
    });
  } else {
    const person = await db.person.create({
      data: {
        firstName,
        lastName,
        email,
        phone,
        dob,
        isMinor,
        mediaOptOut,
        emergencyName: input.emergency?.name ?? null,
        emergencyPhone: input.emergency?.phone ?? null,
        emergencyRelation: input.emergency?.relation ?? null,
        duprId: input.duprId ?? null,
        duprRating: input.duprRating ?? null,
        medicalNotes: input.medicalDisclosures ?? null,
        waiverSignedAt: waiverSigned ? new Date() : null,
        address: x.address ?? null,
        gender: x.gender ?? null,
        howHeard: x.howHeard ?? null,
        stripeCustomerId: x.stripeCustomerId ?? null,
      },
    });
    personId = person.id;
  }

  // Idempotent bulk import: if this person is already registered for this
  // season+division, reuse that registration instead of creating a duplicate.
  if (input.skipIfRegistered) {
    const already = await db.registration.findFirst({
      where: { personId, seasonId: season.id, divisionId },
    });
    if (already) {
      // Re-import: backfill newly-captured intake fields onto the existing
      // registration without creating a duplicate.
      if (Object.keys(regExtra).length) {
        await db.registration.update({ where: { id: already.id }, data: regExtra });
      }
      return {
        personId,
        registrationId: already.id,
        status: already.status,
        duplicate: true,
        registrationCreated: false,
      };
    }
  }

  if (waiverSigned) {
    await db.waiver.create({
      data: {
        personId,
        seasonId: season.id,
        signedAt: new Date(),
        signatureName: input.waiver?.signatureName ?? `${firstName} ${lastName}`,
        mediaConsent: !mediaOptOut,
        parentalConsent: isMinor ? !!input.waiver?.parentalConsent : false,
        documentVersion: "v1",
      },
    });
  }

  const registration = await db.registration.create({
    data: {
      personId,
      seasonId: season.id,
      divisionId,
      skillLevel: input.skillLevel ?? null,
      duprRatingAtReg: input.duprRating ?? null,
      practiceTimePref: input.practiceTimePref ?? null,
      daysThatDontWork: input.daysThatDontWork ?? null,
      partnerRequests: input.partnerRequests ?? null,
      medicalDisclosures: input.medicalDisclosures ?? null,
      mediaOptOut,
      isCoachRegistration: !!input.isCoachRegistration,
      status: match ? "DUPLICATE" : "SUBMITTED",
      ...regExtra,
    },
  });

  // Ranked location preferences (resolve facilities by id or name).
  const prefs = input.locationPrefs ?? [];
  for (let i = 0; i < prefs.length; i++) {
    const lp = prefs[i];
    let facilityId = lp.facilityId ?? null;
    if (!facilityId && lp.facilityName) {
      const f = await db.facility.findFirst({
        where: { name: { equals: lp.facilityName, mode: "insensitive" } },
      });
      facilityId = f?.id ?? null;
    }
    if (facilityId || lp.marketName) {
      await db.locationPreference.create({
        data: {
          registrationId: registration.id,
          facilityId: facilityId ?? undefined,
          marketName: lp.marketName ?? null,
          rank: lp.rank ?? i + 1,
        },
      });
    }
  }

  return {
    personId,
    registrationId: registration.id,
    status: registration.status,
    duplicate: !!match,
    registrationCreated: true,
  };
}
