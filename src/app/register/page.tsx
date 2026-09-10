import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { RegisterForm } from "@/components/RegisterForm";
import { SeasonOverview } from "@/components/SeasonOverview";
import { prisma } from "@/lib/db";
import { ACADEMY_MARKETS, TEAM_CAP } from "@/lib/enums";
import { formatDate, closeDayLabel } from "@/lib/time";
import { teamDisplayName, teamCategoryLabel } from "@/lib/domain/teamName";
import { practiceTimeRange, dayOfWeekPlural } from "@/lib/domain/practiceInfo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Enroll — PURE Academy Fall 2026" },
  description: "Enroll today, pay later. $495 per player for a twelve-session season on a PURE Academy ELITE TEAM.",
  alternates: { canonical: "/register" },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string; location?: string; facility?: string; team?: string }>;
}) {
  const { division: preselectedDivision, location: preselectedLocation, facility: facilityParam, team: teamParam } = await searchParams;

  // A specific facility can be preselected from the Locations page. Resolve it to
  // a public-safe label (private courts never expose name/address) + its market.
  const preferredFacility = facilityParam
    ? await prisma.facility
        .findUnique({ where: { id: facilityParam }, select: { id: true, name: true, market: true, isPrivate: true, generalArea: true } })
        .catch(() => null)
    : null;
  const facilityLabel = preferredFacility
    ? preferredFacility.isPrivate
      ? `${preferredFacility.generalArea ?? preferredFacility.market ?? "Private"} — private court`
      : preferredFacility.name
    : null;
  // If a facility was chosen, its market is the effective location preselect.
  const effectiveLocation = preferredFacility?.market ?? preselectedLocation ?? null;

  const season = await prisma.season.findFirst({
    where: { active: true, isTest: false, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
    include: { divisions: { orderBy: { name: "asc" } } },
  });

  // A "fill this team" link (?team=<id>). Resolve the team so we can show which
  // spot they're filling, prefill its division + location, and pass it through so
  // the signup auto-places them there and takes payment.
  const teamRow = teamParam && season
    ? await prisma.team
        .findFirst({
          where: { id: teamParam, seasonId: season.id, isTest: false, acceptingSignups: true },
          select: {
            id: true, club: true, market: true, divisionCode: true, color: true, gender: true,
            dayOfWeek: true, startTime: true, coachPlays: true, capacity: true,
            division: { select: { name: true } },
            facility: { select: { name: true, isPrivate: true, generalArea: true, crossStreets: true } },
            _count: { select: { members: true } },
          },
        })
        .catch(() => null)
    : null;
  // A full, plain-language summary so a family knows exactly what they're joining:
  // category (Men's/Women's/Youth Boys/Girls + level), the day with start–end
  // time (practices run two hours), and the location (city + court).
  const targetTeam = teamRow
    ? {
        id: teamRow.id,
        label: teamDisplayName(teamRow),
        category: teamCategoryLabel({ divisionCode: teamRow.divisionCode, gender: teamRow.gender, divisionName: teamRow.division?.name ?? null }),
        dayTime: [dayOfWeekPlural(teamRow.dayOfWeek), practiceTimeRange(teamRow.startTime)].filter(Boolean).join(", ") || null,
        location: [
          teamRow.market,
          // A private home never shows the facility (owner) name — cross streets
          // (or general area) only.
          teamRow.facility && !teamRow.facility.isPrivate
            ? teamRow.facility.name
            : teamRow.facility?.crossStreets ?? teamRow.facility?.generalArea ?? null,
        ].filter((v, i, a) => v && a.indexOf(v) === i).join(" · ") || null,
        spotsLeft: Math.max(0, (teamRow.capacity && teamRow.capacity > 0 ? teamRow.capacity : TEAM_CAP) - (teamRow._count.members + (teamRow.coachPlays ? 1 : 0))),
      }
    : null;

  const facilities = await prisma.facility.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, isPrivate: true, generalArea: true, market: true },
  });

  // Respect the season's registration window. A season can be active but not
  // yet open (opensOn in the future) or already closed (closesOn in the past).
  const now = new Date();
  const notYetOpen = season?.opensOn && season.opensOn > now;
  const alreadyClosed = season?.waitlistMode || (season?.closesOn && season.closesOn < now);
  // An open-spots signup (?team= to a team advertising spots) is a REAL, open
  // signup even after the general window closes — we're marketing those spots, so
  // it must never read as "closed / waitlist".
  const showWaitlist = !!alreadyClosed && !targetTeam;

  // Past the deadline we keep the form OPEN for waitlist sign-ups (handled
  // below). Only "no season" or "not open yet" fully closes the page.
  if (!season || notYetOpen) {
    const heading = "Registration isn't open yet";
    const detail = notYetOpen
      ? `Enrollment for ${season!.name} opens on ${formatDate(season!.opensOn)}.`
      : "No active season is currently accepting registrations.";
    return (
      <div>
        <PublicNav />
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
          <p className="mt-2 text-slate-500">{detail}</p>
          <p className="mt-1 text-sm text-slate-400">
            Questions? Email <a href="mailto:team@purepickleball.com" className="text-brand-600 underline">team@purepickleball.com</a>.
          </p>
          <Link href="/" className="btn-secondary mt-6">Back home</Link>
        </div>
      </div>
    );
  }

  // Location options are the academy's markets (cities) players can attend —
  // the base list plus any additional markets found on facilities — so the
  // dropdowns are always populated even before facilities are added.
  const locations = Array.from(
    new Set([
      ...ACADEMY_MARKETS,
      ...facilities.map((f) => f.market ?? "").filter(Boolean),
    ])
  );

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        {showWaitlist && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="font-semibold text-amber-900">Registration for {season.name} has closed{season.closesOn ? ` (${closeDayLabel(season.closesOn)})` : ""}.</p>
            <p className="mt-1 text-sm text-amber-800">
              You can still sign up below to join the <strong>waitlist</strong> — we&apos;ll reach out if a spot opens up. No payment is due unless you&apos;re placed.
            </p>
          </div>
        )}
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            {season.name} · {showWaitlist ? "Waitlist Sign-up" : "Player Enrollment"}
          </p>
          <h1 className="display text-3xl text-brand-900 sm:text-4xl">{showWaitlist ? "Join the PURE Academy waitlist" : "PURE Academy enrollment"}</h1>
          <p className="mt-2 text-slate-600">
            {targetTeam
              ? `Grab your spot on this team. Complete signup, then pay the $${(49500 / 100).toFixed(0)} season fee and pick your apparel — you'll be on the team as soon as your payment clears.`
              : <>Tell us about the player. Our team matches you to the right team, coach, and location — then reaches out to confirm. Enroll today, pay later: we&apos;ll request the ${(49500 / 100).toFixed(0)} season fee only after you&apos;re assigned a team.</>}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Registering a whole family? Choose <strong>&ldquo;Myself and my child(ren)&rdquo;</strong> —
            one waiver covers one adult and up to four kids.
          </p>
        </div>
        {targetTeam ? (
          <div className="mb-6 rounded-xl border-l-4 border-emerald-500 bg-emerald-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              {targetTeam.spotsLeft > 0 ? "You're joining" : "Join the waitlist for"}
            </p>
            <p className="text-xl font-bold text-emerald-900">{targetTeam.label}</p>

            {/* What you're joining — category, day & time, location. */}
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
              {targetTeam.category && (
                <>
                  <dt className="font-semibold text-emerald-800">Team</dt>
                  <dd className="text-slate-700">{targetTeam.category}</dd>
                </>
              )}
              {targetTeam.dayTime && (
                <>
                  <dt className="font-semibold text-emerald-800">When</dt>
                  <dd className="text-slate-700">{targetTeam.dayTime}</dd>
                </>
              )}
              {targetTeam.location && (
                <>
                  <dt className="font-semibold text-emerald-800">Where</dt>
                  <dd className="text-slate-700">{targetTeam.location}</dd>
                </>
              )}
            </dl>

            <p className="mt-3 border-t border-emerald-200 pt-2 text-sm text-slate-600">
              {targetTeam.spotsLeft > 0
                ? `${targetTeam.spotsLeft} spot${targetTeam.spotsLeft === 1 ? "" : "s"} left. Complete signup and go straight to pay your season fee and pick your gear — you'll be on the team as soon as your payment clears.`
                : "This team just filled up — sign up and pay to claim a spot; if it's genuinely full our team will review and place or refund you."}
            </p>
          </div>
        ) : (preselectedDivision || effectiveLocation || facilityLabel) ? (
          <div className="mb-6 rounded-xl border-l-4 border-brand-500 bg-brand-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Signing up for</p>
            <p className="text-lg font-bold text-brand-900">
              {facilityLabel ?? preselectedDivision ?? "PURE Academy"}
              {facilityLabel && preselectedDivision ? <span className="font-semibold text-brand-700"> · {preselectedDivision}</span> : null}
              {!facilityLabel && effectiveLocation ? <span className="font-semibold text-brand-700"> · {effectiveLocation}</span> : null}
            </p>
            <p className="mt-0.5 text-sm text-slate-600">
              {facilityLabel
                ? `We've set ${facilityLabel} as your location — your registration will be placed here. `
                : effectiveLocation
                  ? `We've selected ${effectiveLocation} as your location — `
                  : ""}
              You can still adjust your {preselectedDivision ? "track and " : ""}preferences below.
            </p>
          </div>
        ) : null}
        <SeasonOverview className="mb-6" />

        <RegisterForm
          seasonId={season.id}
          locations={locations}
          preselectedDivision={teamRow?.division?.name ?? preselectedDivision ?? null}
          preselectedLocation={teamRow?.market ?? effectiveLocation}
          preferredFacility={preferredFacility ? { id: preferredFacility.id, label: facilityLabel ?? "" } : null}
          targetTeamId={targetTeam?.id ?? null}
          waitlist={showWaitlist}
        />
      </div>
      <SiteFooter />
    </div>
  );
}
