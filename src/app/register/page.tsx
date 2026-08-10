import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { RegisterForm } from "@/components/RegisterForm";
import { prisma } from "@/lib/db";
import { ACADEMY_MARKETS } from "@/lib/enums";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string }>;
}) {
  const { division: preselectedDivision } = await searchParams;
  const season = await prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
    include: { divisions: { orderBy: { name: "asc" } } },
  });

  const facilities = await prisma.facility.findMany({
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
      ? `Enrollment for ${season!.name} closed on ${season!.closesOn!.toLocaleDateString()}.`
      : notYetOpen
      ? `Enrollment for ${season!.name} opens on ${season!.opensOn!.toLocaleDateString()}.`
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
        {preselectedDivision && (
          <div className="mb-6 rounded-xl border-l-4 border-brand-500 bg-brand-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Signing up for</p>
            <p className="text-lg font-bold text-brand-900">{preselectedDivision}</p>
            <p className="mt-0.5 text-sm text-slate-600">We&apos;ll place the player in this group. You can still adjust the track below.</p>
          </div>
        )}
        <RegisterForm seasonId={season.id} locations={locations} preselectedDivision={preselectedDivision ?? null} />
      </div>
    </div>
  );
}
