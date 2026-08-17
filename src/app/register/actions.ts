"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { formatDate } from "@/lib/time";
import { CONSENT_VERSION, consentRecordText } from "@/lib/consent";
import {
  sendRegistrationConfirmation,
  notifyTeamOfRegistration,
  type EnrolledPlayer,
} from "@/lib/domain/registrationEmail";
import { pushContactToZoho } from "@/lib/integrations/zoho";

export type RegisterState = { error?: string };

// --- Program Interest → Division matching -----------------------------------
// The public form captures a "track" (youth school level or adult Men's/Women's)
// plus a skill band. Prod division names vary, so we match loosely by name and
// fall back to leaving the registration unassigned (staff place them). The chosen
// track is always preserved verbatim in Registration.programInterest.

function genderFromTeam(team: string): string | null {
  const t = team.toLowerCase();
  if (t.includes("women")) return "Female";
  if (t.includes("men")) return "Male";
  return null;
}

function programLabel(team: string, skill: string): string {
  return [team, skill].filter(Boolean).join(" — ") || (skill ? skill : "");
}

function matchDivisionId(
  divisions: { id: string; name: string }[],
  team: string,
  skill: string
): string | null {
  const find = (pred: (n: string) => boolean) =>
    divisions.find((d) => pred(d.name.toLowerCase()))?.id ?? null;
  const t = team.toLowerCase();

  const skillBand = skill ? skill.replace("+", "") : "";
  const bySkill = () => (skillBand ? find((n) => n.includes(skillBand)) : null);

  // Youth levels match by school level only (never fall through to an adult band).
  if (t.includes("high school")) return find((n) => n.includes("high school") || /\bhs\b/.test(n));
  if (t.includes("middle")) return find((n) => n.includes("middle"));
  if (t.includes("elementary")) return find((n) => n.includes("elementary") || n.includes("elem"));

  // Adult tracks: prefer a gendered division, else fall back to the skill band.
  if (t.includes("women"))
    return (
      find((n) => n.includes("women") && (!skillBand || n.includes(skillBand))) ||
      find((n) => n.includes("women")) ||
      bySkill()
    );
  if (t.includes("men"))
    return (
      find((n) => /\bmen('s)?\b/.test(n) && !n.includes("women") && (!skillBand || n.includes(skillBand))) ||
      find((n) => /\bmen('s)?\b/.test(n) && !n.includes("women")) ||
      bySkill()
    );

  // No team chosen — last resort match by skill band.
  return bySkill();
}

type PlayerInput = {
  firstName: string;
  lastName: string;
  dob: string;
  team: string;
  skill: string;
  isChild: boolean;
};

// Creates the Person, a signed Waiver, and one Registration for a single player.
async function enrollPlayer(opts: {
  player: PlayerInput;
  seasonId: string;
  divisions: { id: string; name: string }[];
  signatureName: string;
  mediaOptOut: boolean;
  waiverVersion: string;
  locations: string[];
  practiceTimes: string[];
  comments: string;
  // For an adult who is also the contact, reuse that Person instead of creating one.
  existingPersonId?: string;
  guardianId?: string;
  email?: string;
  phone?: string;
  // Grouping the family clicked on the Programs page (division name → id), used
  // as a fallback when the player's own track doesn't resolve a division.
  preferredDivisionId?: string | null;
  preferredDivisionName?: string | null;
  // A specific facility chosen from the Locations page — stored as the top-ranked
  // location preference so the registration is placed at that court.
  preferredFacilityId?: string | null;
  preferredFacilityMarket?: string | null;
}): Promise<void> {
  const { player } = opts;
  const dob = player.dob ? new Date(player.dob) : null;
  const isMinor = player.isChild;

  let personId = opts.existingPersonId ?? "";
  if (personId) {
    await prisma.person.update({
      where: { id: personId },
      data: {
        dob: dob ?? undefined,
        isMinor,
        gender: genderFromTeam(player.team) ?? undefined,
        waiverSignedAt: new Date(),
      },
    });
  } else {
    const person = await prisma.person.create({
      data: {
        firstName: player.firstName,
        lastName: player.lastName,
        email: opts.email || null,
        phone: opts.phone || null,
        dob,
        isMinor,
        gender: genderFromTeam(player.team),
        mediaOptOut: opts.mediaOptOut,
        guardianId: opts.guardianId ?? null,
        waiverSignedAt: new Date(),
      },
    });
    personId = person.id;
  }

  await prisma.waiver.create({
    data: {
      personId,
      seasonId: opts.seasonId,
      signedAt: new Date(),
      signatureName: opts.signatureName,
      mediaConsent: !opts.mediaOptOut,
      // A minor's registration is consented to by the signing guardian.
      parentalConsent: isMinor,
      documentVersion: opts.waiverVersion,
    },
  });

  const registration = await prisma.registration.create({
    data: {
      personId,
      seasonId: opts.seasonId,
      divisionId: matchDivisionId(opts.divisions, player.team, player.skill) ?? opts.preferredDivisionId ?? null,
      skillLevel: player.skill || null,
      programInterest: programLabel(player.team, player.skill) || opts.preferredDivisionName || null,
      practiceTimePref: opts.practiceTimes.join(", ") || null,
      schedule: opts.practiceTimes.join(", ") || null,
      partnerRequests: opts.comments || null,
      mediaOptOut: opts.mediaOptOut,
      status: "SUBMITTED",
    },
  });

  // Top-rank the specific facility if one was chosen, then the market prefs —
  // skipping the facility's own market to avoid a duplicate.
  let rank = 1;
  if (opts.preferredFacilityId) {
    await prisma.locationPreference.create({
      data: { registrationId: registration.id, facilityId: opts.preferredFacilityId, marketName: opts.preferredFacilityMarket ?? null, rank: rank++ },
    });
  }
  for (const market of opts.locations) {
    if (opts.preferredFacilityMarket && market.toLowerCase() === opts.preferredFacilityMarket.toLowerCase()) continue;
    await prisma.locationPreference.create({
      data: { registrationId: registration.id, marketName: market, rank: rank++ },
    });
  }
}

// PURE Academy enrollment — mirrors the public PURE website form. One waiver
// signing covers up to one adult (the person filling it out, if playing) plus
// up to four children. Each enrolled player gets a Person, a signed Waiver, and
// a Registration matched to a division by their chosen program track.
export async function registerAction(
  _prev: RegisterState | undefined,
  formData: FormData
): Promise<RegisterState> {
  const g = (k: string) => String(formData.get(k) ?? "").trim();
  const getAll = (k: string) => formData.getAll(k).map((v) => String(v).trim());

  const seasonId = g("seasonId");
  if (!seasonId) return { error: "No active season is open for registration." };

  // Re-check the registration window server-side — the form may have been open
  // in a browser tab when the season closed (or hasn't opened yet).
  const windowSeason = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!windowSeason || !windowSeason.active) return { error: "This season is no longer accepting registrations." };
  const nowTs = new Date();
  if (windowSeason.opensOn && windowSeason.opensOn > nowTs) return { error: `Registration opens on ${formatDate(windowSeason.opensOn)}.` };
  if (windowSeason.closesOn && windowSeason.closesOn < nowTs) return { error: `Registration closed on ${formatDate(windowSeason.closesOn)}.` };

  const mode = g("mode") || "adult"; // "adult" | "child" | "both"
  const adultPlaying = mode === "adult" || mode === "both";
  const hasChildren = mode === "child" || mode === "both";

  // Contact / primary person (adult player in adult|both mode; guardian in child mode).
  const firstName = g("primaryFirst");
  const lastName = g("primaryLast");
  const email = g("primaryEmail").toLowerCase();
  const phone = g("primaryPhone");
  const comments = g("comments");
  const password = g("password");
  const passwordConfirm = g("passwordConfirm");

  const waiverSigned = formData.get("waiver") === "on";
  const signatureName = g("signatureName");
  const mediaOptOut = formData.get("mediaOptOut") === "on";
  const waiverVersion = g("waiverVersion") || "2026-08";
  const emailOptIn = formData.get("emailOptIn") === "on";
  const smsOptIn = formData.get("smsOptIn") === "on";

  if (!firstName || !lastName)
    return { error: hasChildren && !adultPlaying ? "Parent/guardian name is required." : "Your name is required." };
  if (!email) return { error: "An email is required." };
  if (!phone) return { error: "A phone number is required." };
  if (!waiverSigned || !signatureName)
    return { error: "The liability waiver must be read, agreed to, and signed." };
  if (password && password.length < 8)
    return { error: "Password must be at least 8 characters." };
  if (password && password !== passwordConfirm)
    return { error: "Passwords don't match." };

  // Shared preferences.
  const locations = getAll("location").filter(Boolean);
  const practiceTimes = getAll("practiceTime").filter(Boolean);

  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { divisions: { select: { id: true, name: true } } },
  });
  const divisions = season?.divisions ?? [];

  // Grouping preselected from the Programs page (division name via ?division=).
  const preferredDivisionName = g("preferredDivision") || null;
  const preferredDivisionId = preferredDivisionName
    ? divisions.find((d) => d.name.toLowerCase() === preferredDivisionName.toLowerCase())?.id ?? null
    : null;

  // Specific facility chosen from the Locations page.
  const preferredFacilityId = g("preferredFacilityId") || null;
  const preferredFacility = preferredFacilityId
    ? await prisma.facility.findUnique({ where: { id: preferredFacilityId }, select: { id: true, market: true } }).catch(() => null)
    : null;
  const preferredFacilityMarket = preferredFacility?.market ?? null;

  // Reuse an existing person by email so families don't create duplicates.
  const existing = await prisma.person.findFirst({ where: { email } });
  let primaryId: string;
  if (existing) {
    primaryId = existing.id;
    await prisma.person.update({
      where: { id: existing.id },
      data: {
        firstName: existing.firstName || firstName,
        lastName: existing.lastName || lastName,
        phone: existing.phone ?? (phone || null),
        mediaOptOut,
      },
    });
  } else {
    const primary = await prisma.person.create({
      data: { firstName, lastName, email: email || null, phone: phone || null, mediaOptOut },
    });
    primaryId = primary.id;
  }

  // Express email/SMS consent (TCPA / Twilio A2P). Recorded against the primary
  // contact with the exact language and an auditable consent row.
  if (emailOptIn || smsOptIn) {
    const now = new Date();
    await prisma.person.update({
      where: { id: primaryId },
      data: { ...(emailOptIn ? { emailConsentAt: now } : {}), ...(smsOptIn ? { smsConsentAt: now } : {}) },
    });
    await prisma.messagingConsent.create({
      data: {
        personId: primaryId,
        name: `${firstName} ${lastName}`.trim(),
        email: email || null,
        phone: phone || null,
        emailOptIn,
        smsOptIn,
        consentText: consentRecordText(emailOptIn, smsOptIn),
        consentVersion: CONSENT_VERSION,
        source: "registration",
      },
    });
  }

  const enrolled: EnrolledPlayer[] = [];

  // The adult (contact) plays: enroll them, reusing the primary Person.
  if (adultPlaying) {
    const team = g("primaryTeam");
    const skill = g("primarySkill");
    await enrollPlayer({
      player: { firstName, lastName, dob: g("primaryDob"), team, skill, isChild: false },
      seasonId,
      divisions,
      signatureName,
      mediaOptOut,
      waiverVersion,
      locations,
      practiceTimes,
      comments,
      existingPersonId: primaryId,
      email: email || undefined,
      phone: phone || undefined,
      preferredDivisionId,
      preferredDivisionName,
      preferredFacilityId: preferredFacility?.id ?? null,
      preferredFacilityMarket,
    });
    enrolled.push({ name: `${firstName} ${lastName}`, program: programLabel(team, skill) || preferredDivisionName || "" });
  }

  // Children (up to 4), each guardian-signed on the same waiver.
  if (hasChildren) {
    const kf = getAll("kidFirst");
    const kl = getAll("kidLast");
    const kd = getAll("kidDob");
    const kt = getAll("kidTeam");
    const ks = getAll("kidSkill");
    const kids = kf
      .map((fn, i) => ({
        firstName: fn,
        lastName: kl[i] ?? "",
        dob: kd[i] ?? "",
        team: kt[i] ?? "",
        skill: ks[i] ?? "",
        isChild: true,
      }))
      .filter((k) => k.firstName && k.lastName)
      .slice(0, 4);

    if (!adultPlaying && kids.length === 0)
      return { error: "Add at least one player (first and last name)." };

    for (const kid of kids) {
      await enrollPlayer({
        player: kid,
        seasonId,
        divisions,
        signatureName,
        mediaOptOut,
        waiverVersion,
        locations,
        practiceTimes,
        comments,
        guardianId: primaryId,
        preferredDivisionId,
        preferredDivisionName,
      preferredFacilityId: preferredFacility?.id ?? null,
      preferredFacilityMarket,
      });
      enrolled.push({ name: `${kid.firstName} ${kid.lastName}`, program: programLabel(kid.team, kid.skill) || preferredDivisionName || "" });
    }
  }

  // Optional portal login. Adult-only → PLAYER; guardian present → PARENT.
  if (password && email) {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(password),
          role: hasChildren ? "PARENT" : "PLAYER",
          personId: primaryId,
        },
      });
    }
  }

  // Confirmation to the registrant + a heads-up to the team inbox. Email
  // failures never block a successful registration.
  if (email && enrolled.length) {
    const summary = {
      toEmail: email,
      recipientName: firstName,
      seasonName: season?.name ?? "PURE Academy",
      players: enrolled,
      locations,
      practiceTimes,
    };
    try {
      await sendRegistrationConfirmation(summary);
      await notifyTeamOfRegistration(summary);
    } catch {
      // swallow — registration already succeeded
    }
  }

  // Sync the account-holder contact to Zoho Campaigns (dormant until configured).
  // The registrant consented during registration, so this is a silent, direct
  // add. Never let a Zoho hiccup affect a successful registration.
  if (email) {
    try {
      const r = await pushContactToZoho({ email, firstName, lastName, phone });
      if (r.ok) {
        await prisma.person.update({ where: { id: primaryId }, data: { zohoSyncedAt: new Date() } }).catch(() => {});
      } else if (!("skipped" in r && r.skipped)) {
        console.warn("[zoho] push failed:", r);
      }
    } catch (e) {
      console.warn("[zoho] push threw:", e);
    }
  }

  redirect("/register/thanks");
}
