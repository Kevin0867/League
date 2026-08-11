import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { RegisterForm } from "@/components/RegisterForm";
import { prisma } from "@/lib/db";
import { ACADEMY_MARKETS } from "@/lib/enums";
import { formatDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string; location?: string; facility?: string }>;
}) {
  const { division: preselectedDivision, location: preselectedLocation, facility: facilityParam } = await searchParams;

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
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
    include: { divisions: { orderBy: { name: "asc" } } },
  });

  const facilities = await prisma.facility.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, isPrivate: true, generalArea: true, market: true },
  });

  // Respect the season's registration window. A season can be active but not
  // yet open (opensOn in the future) or already closed (closesOn in the past).
  const now = new Date();
  const notYetOpen = season?.opensOn && season.opensOn > now;
  const alreadyClosed = season?.closesOn && season.closesOn < now;

  if (!season || notYetOpen || alreadyClosed) {
    const heading = alreadyClosed ? "Registration has closed" : "Registration isn't open yet";
    const detail = alreadyClosed
      ? `Enrollment for ${season!.name} closed on ${formatDate(season!.closesOn)}.`
      : notYetOpen
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
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            {season.name} · Player Enrollment
          </p>
          <h1 className="display text-3xl text-brand-900 sm:text-4xl">PURE Academy enrollment</h1>
          <p className="mt-2 text-slate-600">
            Tell us about the player. Our team matches you to the right team, coach, and
            location — then reaches out to confirm. Enroll today, pay later: we&apos;ll request
            the ${(49500 / 100).toFixed(0)} season fee only after you&apos;re assigned a team.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Registering a whole family? Choose <strong>&ldquo;Myself and my child(ren)&rdquo;</strong> —
            one waiver covers one adult and up to four kids.
          </p>
        </div>
        {(preselectedDivision || effectiveLocation || facilityLabel) && (
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
        )}
        <RegisterForm
          seasonId={season.id}
          locations={locations}
          preselectedDivision={preselectedDivision ?? null}
          preselectedLocation={effectiveLocation}
          preferredFacility={preferredFacility ? { id: preferredFacility.id, label: facilityLabel ?? "" } : null}
        />
      </div>
      <SiteFooter />
    </div>
  );
}
