import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { isPublic } from "@/lib/domain/coachPublic";
import { effectiveRoles } from "@/lib/enums";

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

// Fixed hero banner for /coaches. Deliberately NOT tied to any coach record —
// it's a committed page asset (image + copy) so it always shows regardless of
// which coaches exist in the database. Managed by editing these constants and
// replacing the image file in the repo.
const HERO_IMG = "/coaches/stephanie-hero.jpg";
const HERO_EYEBROW = "Director & Head Coach";
const HERO_NAME = "Stephanie Newton";
const HERO_BIO =
  "Professional player — Phoenix Firebirds, Major League Pickleball Champions Series, 40+ Prime Division. " +
  "Competing through the Fall 2026 season. RPO Level 1 and Level 2 certified. 2025 APPL State and National Champion. " +
  "20+ years coaching Arizona athletes. Director, Arizona High School Pickleball. Director, Arizona Club Pickleball.";
const HERO_MARKETS = "Mesa · Youth and adults, beginner through professional.";

export default async function CoachesPage() {
  // Only PUBLISHED coach records appear — the "Publish to site" toggle governs
  // grid visibility. The hero above the grid is a fixed page element (see the
  // HERO_* constants), so it no longer depends on a coach record existing.
  const coaches = await prisma.coach.findMany({
    where: { publishedOnSite: true },
    include: { person: { include: { user: true } } },
    orderBy: { person: { firstName: "asc" } },
  });
  // Keep the featured Director out of the staff grid so she isn't shown twice
  // (once in the fixed hero, once as a card). The grid hides incomplete profiles:
  // a coach appears only once they have a photo, a market, and coaching levels —
  // a name-only card reads worse than no card, and it keeps seeded/unconfirmed
  // records off the one page a parent visits to decide whether to trust us.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const isDirector = (c: (typeof coaches)[number]) => norm(`${c.person.firstName} ${c.person.lastName}`) === norm(HERO_NAME);
  const isComplete = (c: (typeof coaches)[number]) =>
    !!c.person.imageUrl && parseMarkets(c.marketsCovered).length > 0 && !!(c.coachingLevels && c.coachingLevels.trim());
  // Only actual coaches appear: if the person holds a login, it must carry the
  // COACH role — so unchecking Coach on the Access page removes them here. A
  // published coach with NO login (e.g. a seeded record) stays governed by the
  // publish toggle alone, so we don't hide anyone who simply never got an account.
  const hasCoachRole = (c: (typeof coaches)[number]) => {
    const u = c.person.user;
    return !u || effectiveRoles(u).includes("COACH");
  };
  const grid = coaches.filter((c) => !isDirector(c) && isComplete(c) && hasCoachRole(c));

  return (
    <div>
      <PublicNav />

      <div className="mx-auto max-w-6xl px-4 py-12">
        <p className="eyebrow">Coaching</p>
        <h1 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">
          The people <em className="text-accent-600">on court</em> with your player
        </h1>

        {/* Fixed hero banner — a committed page asset, always shown, not tied to
            any coach record (see the HERO_* constants). */}
        <section className="mt-8 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-brand-800 to-brand-950 text-white shadow-xl ring-1 ring-white/10">
          <div className="grid gap-0 lg:grid-cols-2">
            <div className="min-h-[360px] bg-gradient-to-br from-brand-800 to-brand-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={HERO_IMG}
                alt={`${HERO_NAME} — ${HERO_EYEBROW}`}
                className="h-full w-full object-cover object-top"
              />
            </div>
            <div className="p-8 sm:p-10">
              <p className="eyebrow eyebrow-light">{HERO_EYEBROW}</p>
              <h2 className="display mt-2 text-3xl text-white">{HERO_NAME}</h2>
              <p className="mt-4 whitespace-pre-line text-brand-100">{HERO_BIO}</p>
              <p className="mt-3 text-sm text-brand-200">{HERO_MARKETS}</p>
            </div>
          </div>
        </section>

        {/* How we screen and train — directly below the hero. */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="font-semibold text-slate-900">How we screen and train our coaches</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" /><span>Every coach completes a background check and PURE curriculum training before Week 1, without exception.</span></li>
            <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" /><span>RPO is an official sponsor of PURE Academy. RPO Level 1 certification carries SafeSport certification and additional insurance.</span></li>
            <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" /><span>One coach per team for the full twelve weeks wherever possible.</span></li>
          </ul>
        </section>

        {/* Coach grid — the published staff, each card links to a public profile. */}
        <section className="mt-14 border-t border-slate-200 pt-10">
            <h2 className="display text-2xl text-brand-900">Meet the coaching staff</h2>
            <p className="mt-1 text-sm text-slate-500">Tap a coach to see their background and credentials.</p>
            {grid.length === 0 ? (
              <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                More of our coaching staff will be featured here as the season is finalized.
              </p>
            ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {grid.map((c) => {
                const markets = isPublic(c.publicHidden, "markets") ? parseMarkets(c.marketsCovered) : [];
                const name = `${c.person.firstName} ${c.person.lastName}`;
                return (
                  <Link
                    key={c.id}
                    href={`/coaches/${c.person.id}`}
                    className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-brand-300 hover:shadow-md"
                  >
                    <div className="aspect-[4/3] overflow-hidden bg-gradient-to-br from-brand-100 to-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.person.imageUrl ?? `/coaches/${c.person.id}.jpg`} alt={name} className="h-full w-full object-cover object-top transition group-hover:scale-[1.02]" />
                    </div>
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold text-slate-900 group-hover:text-brand-700">{name}</h3>
                        {c.isProCoach && <span className="badge bg-brand-100 text-brand-800">Pro</span>}
                      </div>
                      {markets.length > 0 && <p className="mt-0.5 text-sm text-slate-500">{markets.join(" · ")}</p>}
                      {isPublic(c.publicHidden, "levels") && c.coachingLevels && <p className="mt-2 text-sm text-slate-600">{c.coachingLevels}</p>}
                      {isPublic(c.publicHidden, "credentials") && (c.rpoCertLevel || c.certifications) && (
                        <p className="mt-2 text-xs text-slate-500">
                          {[c.rpoCertLevel, c.certifications].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <span className="mt-3 inline-block text-xs font-semibold text-brand-600 group-hover:text-brand-800">View profile →</span>
                    </div>
                  </Link>
                );
              })}
            </div>
            )}
          </section>

      </div>

      <SiteFooter />
    </div>
  );
}
