import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { RegisterForm } from "@/components/RegisterForm";
import { prisma } from "@/lib/db";
import { ACADEMY_MARKETS } from "@/lib/enums";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const season = await prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
    include: { divisions: { orderBy: { name: "asc" } } },
  });

  const facilities = await prisma.facility.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, isPrivate: true, generalArea: true, market: true },
  });

  if (!season) {
    return (
      <div>
        <PublicNav />
        <div className="mx-auto max-w-2xl px-4 py-20 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Registration isn&apos;t open yet</h1>
          <p className="mt-2 text-slate-500">No active season is currently accepting registrations.</p>
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
        <RegisterForm seasonId={season.id} locations={locations} />
      </div>
    </div>
  );
}
