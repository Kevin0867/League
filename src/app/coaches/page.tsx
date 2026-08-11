import type { Metadata } from "next";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Our Coaches — PURE Academy" },
  description: "Certified, background-checked coaches across the Phoenix metro, led by MLP professional Stephanie Newton.",
  alternates: { canonical: "/coaches" },
};

function parseMarkets(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export default async function CoachesPage() {
  const coaches = await prisma.coach.findMany({
    where: { publishedOnSite: true },
    include: { person: true },
    orderBy: { person: { lastName: "asc" } },
  });
  // The Director leads the page as a hero, so keep her out of the card grid.
  const isDirector = (c: (typeof coaches)[number]) => `${c.person.firstName} ${c.person.lastName}`.toLowerCase() === "stephanie newton";
  const grid = coaches.filter((c) => !isDirector(c));
  // The Director hero is a fixed, committed asset (managed by replacing the file
  // in the repo), so it's never overridden by an uploaded profile image.
  const heroImg = "/coaches/stephanie-hero.jpg";

  return (
    <div>
      <PublicNav />

      <div className="mx-auto max-w-6xl px-4 py-12">
        <p className="eyebrow">Coaching</p>
        <h1 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">
          The people <em className="text-accent-600">on court</em> with your player
        </h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Every PURE coach completes a background check and PURE curriculum training before Week 1 — without exception.
        </p>

        {/* Director — hero treatment */}
        <section className="mt-8 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-brand-800 to-brand-950 text-white shadow-xl ring-1 ring-white/10">
          <div className="grid gap-0 lg:grid-cols-2">
            <div className="min-h-[360px] bg-gradient-to-br from-brand-800 to-brand-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroImg}
                alt="Stephanie Newton — Phoenix Firebirds, Major League Pickleball"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="p-8 sm:p-10">
              <p className="eyebrow eyebrow-light">Director &amp; Head Coach</p>
              <h2 className="display mt-2 text-3xl text-white">Stephanie Newton</h2>
              <p className="mt-4 text-brand-100">
                <strong className="text-white">Professional player — Phoenix Firebirds</strong>, Major League
                Pickleball Champions Series, 40+ Prime Division. Competing through the Fall 2026 season.
                <strong className="text-white"> RPO Level 1 and Level 2 certified.</strong> 2025 APPL State and
                National Champion. 20+ years coaching Arizona athletes. Director, Arizona High School Pickleball.
                Director, Arizona Club Pickleball.
              </p>
              <p className="mt-3 text-sm text-brand-200">Mesa · Youth and adults, beginner through professional.</p>
              <p className="mt-5 border-l-2 border-accent-400 pl-4 text-lg italic text-white">
                The Academy is directed by someone competing at the top of the sport during the same season she is
                coaching it.
              </p>
            </div>
          </div>
        </section>

        {/* Coach grid */}
        {grid.length > 0 && (
          <section className="mt-12">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">The coaching staff</h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {grid.map((c) => {
                const markets = parseMarkets(c.marketsCovered);
                const name = `${c.person.firstName} ${c.person.lastName}`;
                return (
                  <div key={c.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="aspect-[4/3] bg-gradient-to-br from-brand-100 to-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.person.imageUrl ?? `/coaches/${c.person.id}.jpg`} alt={name} className="h-full w-full object-cover" />
                    </div>
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold text-slate-900">{name}</h3>
                        {c.isProCoach && <span className="badge bg-brand-100 text-brand-800">Pro</span>}
                      </div>
                      {markets.length > 0 && <p className="mt-0.5 text-sm text-slate-500">{markets.join(" · ")}</p>}
                      {c.coachingLevels && <p className="mt-2 text-sm text-slate-600">{c.coachingLevels}</p>}
                      {(c.rpoCertLevel || c.certifications) && (
                        <p className="mt-2 text-xs text-slate-500">
                          {[c.rpoCertLevel, c.certifications].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Trust block */}
        <section className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="font-semibold text-slate-900">How we screen and train our coaches</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" /><span>Every coach completes a background check and PURE curriculum training before Week 1, without exception.</span></li>
            <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" /><span>RPO is an official sponsor of PURE Academy. RPO Level 1 certification carries SafeSport certification and additional insurance.</span></li>
            <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" /><span>One coach per team for the full twelve weeks wherever possible.</span></li>
          </ul>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}
