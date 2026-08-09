import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { FamilyRegisterForm } from "@/components/FamilyRegisterForm";
import { prisma } from "@/lib/db";
import { ACADEMY_MARKETS } from "@/lib/enums";

export const dynamic = "force-dynamic";

export default async function FamilyRegisterPage() {
  const season = await prisma.season.findFirst({
    where: { active: true, program: "PURE_ACADEMY" },
    orderBy: { startDate: "desc" },
    include: { divisions: { orderBy: { name: "asc" } } },
  });

  const facilities = await prisma.facility.findMany({ select: { market: true } });

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

  const locations = Array.from(
    new Set([...ACADEMY_MARKETS, ...facilities.map((f) => f.market ?? "").filter(Boolean)])
  );

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">{season.name}</p>
          <h1 className="display text-3xl text-brand-900 sm:text-4xl">Family registration</h1>
          <p className="mt-2 text-slate-600">
            Registering more than one child? Add each of them here and sign one waiver for all.{" "}
            <Link href="/register" className="text-accent-700 underline">Registering just yourself or one player?</Link>
          </p>
        </div>
        <FamilyRegisterForm
          seasonId={season.id}
          divisions={season.divisions.map((d) => ({ id: d.id, name: d.name }))}
          locations={locations}
        />
      </div>
    </div>
  );
}
