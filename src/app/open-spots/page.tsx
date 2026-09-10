import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { listOpenSpotTeams, getOpenSpotsCopy } from "@/lib/domain/openSpots";
import { formatCents } from "@/lib/money";
import { SeasonOverview } from "@/components/SeasonOverview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Open Spots — PURE Academy" },
  description: "PURE Academy teams with open spots — sign up, sign the waiver, pick your apparel, and pay to claim your place.",
  alternates: { canonical: "/open-spots" },
};

export default async function OpenSpotsPage() {
  const season =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, select: { id: true } }));

  const [teams, copy, rate] = await Promise.all([
    season ? listOpenSpotTeams(season.id) : Promise.resolve([]),
    getOpenSpotsCopy(),
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { seasonFeeCents: true } }),
  ]);
  const feeCents = rate?.seasonFeeCents ?? 49500;

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-5xl px-4 py-12">
        <p className="eyebrow">Join a team</p>
        <h1 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">{copy.headline}</h1>
        <p className="mt-3 max-w-2xl whitespace-pre-line text-slate-600">{copy.intro}</p>

        <SeasonOverview className="mt-6" />

        {teams.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
            No open spots right now — check back soon, or{" "}
            <Link href="/register" className="text-brand-700 hover:underline">join the general list</Link> and we&apos;ll place you.
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((t) => (
              <div key={t.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-bold text-slate-900">{t.name}</h2>
                  <span className="shrink-0 rounded-full bg-accent-100 px-2.5 py-1 text-xs font-bold text-brand-900">
                    {t.spotsLeft} spot{t.spotsLeft === 1 ? "" : "s"} left
                  </span>
                </div>
                <dl className="mt-3 space-y-1 text-sm text-slate-600">
                  {t.category && <div><dt className="inline font-medium text-slate-500">Division: </dt><dd className="inline">{t.category}</dd></div>}
                  {t.dayTime && <div><dt className="inline font-medium text-slate-500">Practice: </dt><dd className="inline">{t.dayTime}</dd></div>}
                  {t.location && <div><dt className="inline font-medium text-slate-500">Where: </dt><dd className="inline">{t.location}</dd></div>}
                  <div><dt className="inline font-medium text-slate-500">Season fee: </dt><dd className="inline">{formatCents(feeCents)}</dd></div>
                </dl>
                <div className="mt-auto pt-4">
                  <Link href={`/register?team=${t.id}`} className="btn-primary w-full justify-center text-sm">
                    Sign up for this team →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-10 text-sm text-slate-500">
          Signing up covers the waiver, apparel, and season fee in one flow. You&apos;re placed on the team as soon as your payment clears.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}
