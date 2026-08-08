import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { RegisterForm } from "@/components/RegisterForm";
import { prisma } from "@/lib/db";

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

  // Public-safe facility labels — private courts appear by general area only (§15).
  const facilityOptions = facilities.map((f) => ({
    id: f.id,
    name: f.isPrivate
      ? `${f.generalArea ?? f.market ?? "Private court"} (private)`
      : f.name,
  }));

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">{season.name}</p>
          <h1 className="text-3xl font-bold text-slate-900">Season registration</h1>
          <p className="mt-2 text-slate-600">
            Enroll today, pay later. We&apos;ll request the ${(49500 / 100).toFixed(0)} season
            fee only after you&apos;re assigned a team, coach, location, day, and time.
          </p>
        </div>
        <RegisterForm
          seasonId={season.id}
          divisions={season.divisions.map((d) => ({ id: d.id, name: d.name }))}
          facilities={facilityOptions}
        />
      </div>
    </div>
  );
}
