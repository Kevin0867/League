import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { isPublic, parseMarketsJson } from "@/lib/domain/coachPublic";

export const dynamic = "force-dynamic";

async function getCoach(personId: string) {
  const coach = await prisma.coach.findFirst({
    where: { personId, publishedOnSite: true },
    include: { person: true },
  });
  return coach;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const coach = await getCoach(id);
  if (!coach) return { title: { absolute: "Coach — PURE Academy" } };
  const name = `${coach.person.firstName} ${coach.person.lastName}`;
  return {
    title: { absolute: `${name} — PURE Academy Coaches` },
    description: `${name}, PURE Academy coach.`,
    alternates: { canonical: `/coaches/${id}` },
  };
}

export default async function PublicCoachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const coach = await getCoach(id);
  if (!coach) notFound();

  const name = `${coach.person.firstName} ${coach.person.lastName}`;
  const markets = parseMarketsJson(coach.marketsCovered);
  const showBio = isPublic(coach.publicHidden, "bio") && coach.bio;
  const showCred = isPublic(coach.publicHidden, "credentials") && (coach.rpoCertLevel || coach.certifications);
  const showMarkets = isPublic(coach.publicHidden, "markets") && markets.length > 0;
  const showLevels = isPublic(coach.publicHidden, "levels") && coach.coachingLevels;

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/coaches" className="text-sm text-slate-500 hover:text-brand-700 hover:underline">← All coaches</Link>

        <div className="mt-4 grid gap-8 sm:grid-cols-[minmax(0,320px)_1fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-brand-100 to-slate-100 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coach.person.imageUrl ?? `/coaches/${coach.person.id}.jpg`} alt={name} className="aspect-[4/5] h-full w-full object-cover object-top" />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display text-3xl text-brand-900 sm:text-4xl">{name}</h1>
              {coach.isProCoach && <span className="badge bg-brand-100 text-brand-800">Pro</span>}
            </div>

            {showMarkets && <p className="mt-2 text-slate-500">{markets.join(" · ")}</p>}

            {showBio && <p className="mt-5 whitespace-pre-line text-slate-700">{coach.bio}</p>}

            {showLevels && (
              <div className="mt-5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Coaches</h2>
                <p className="mt-1 text-slate-700">{coach.coachingLevels}</p>
              </div>
            )}

            {showCred && (
              <div className="mt-5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Credentials</h2>
                <p className="mt-1 text-slate-700">{[coach.rpoCertLevel, coach.certifications].filter(Boolean).join(" · ")}</p>
              </div>
            )}

            {!showBio && !showCred && !showMarkets && !showLevels && (
              <p className="mt-5 text-slate-500">A PURE Academy coach.</p>
            )}

            {/* Only claim a credential we can evidence (Community Layer §2.3):
                show the screening line when this coach has a background check on
                record, and say nothing where one isn't yet complete. */}
            {coach.backgroundCheckDate && (
              <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Background check on file{coach.safeSportCertified ? " · SafeSport certified" : ""} · PURE curriculum training.
              </div>
            )}
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
