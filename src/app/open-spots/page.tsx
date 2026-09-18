import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { listOpenSpotTeams, listSubsNeeded, getOpenSpotsCopy } from "@/lib/domain/openSpots";
import { proratedSeasonFee } from "@/lib/payments/proration";
import { formatCents } from "@/lib/money";
import { SeasonOverview } from "@/components/SeasonOverview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Open Spots — PURE Academy" },
  description: "PURE Academy teams with open spots and practices that need a substitute. Join a team (prorated to the weeks left) or sub in for a single practice — no charge.",
  alternates: { canonical: "/open-spots" },
};

export default async function OpenSpotsPage({ searchParams }: { searchParams: Promise<{ subok?: string; suberr?: string }> }) {
  const sp = await searchParams;
  const season =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true, calendar: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, select: { id: true, calendar: true } }));

  const [teams, subs, copy, rate] = await Promise.all([
    season ? listOpenSpotTeams(season.id) : Promise.resolve([]),
    season ? listSubsNeeded(season.id) : Promise.resolve([]),
    getOpenSpotsCopy(),
    prisma.rateConfig.findFirst({ orderBy: { createdAt: "desc" }, select: { seasonFeeCents: true } }),
  ]);
  const feeCents = rate?.seasonFeeCents ?? 49500;
  const proration = proratedSeasonFee(feeCents, season?.calendar ?? null, new Date());

  const SUB_ERR: Record<string, string> = {
    full: "Sorry — that spot was just taken. Please pick another practice.",
    notfound: "That practice is no longer available.",
    fields: "Please add your name and an email or mobile number.",
  };

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-6xl px-4 py-12">
        <p className="eyebrow">Open Spots</p>
        <h1 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">{copy.headline}</h1>
        <p className="mt-3 max-w-2xl whitespace-pre-line text-slate-600">{copy.intro}</p>

        <SeasonOverview className="mt-6" />

        {sp.subok && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <span className="font-semibold">You&apos;re in!</span> Thanks for subbing in for {decodeURIComponent(sp.subok)}. Check your texts/email for the participation waiver and your practice details — and complete the waiver so you&apos;re cleared to play.
          </div>
        )}
        {sp.suberr && (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{SUB_ERR[sp.suberr] ?? "Something went wrong — please try again."}</div>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          {/* ── Column 1: Join a team ─────────────────────────────────────── */}
          <section id="join">
            <h2 className="text-lg font-bold text-brand-900">Open spots on a team</h2>
            <p className="mt-1 text-sm text-slate-600">
              Join for the season. <span className="font-semibold text-brand-800">All registrations are prorated based on the number of weeks left in the season</span>
              {proration.prorated
                ? ` — about ${formatCents(proration.feeCents)} now (${proration.weeksRemaining} of ${proration.totalWeeks} weeks left) instead of the full ${formatCents(feeCents)}.`
                : ` (currently the full ${formatCents(feeCents)}; it prorates automatically as the season progresses).`}
            </p>

            {teams.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                No open team spots right now — check back soon, or{" "}
                <Link href="/register" className="text-brand-700 hover:underline">join the general list</Link> and we&apos;ll place you.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {teams.map((t) => (
                  <div key={t.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-bold text-slate-900">{t.name}</h3>
                      <span className="shrink-0 rounded-full bg-accent-100 px-2.5 py-1 text-xs font-bold text-brand-900">
                        {t.spotsLeft} spot{t.spotsLeft === 1 ? "" : "s"} left
                      </span>
                    </div>
                    <dl className="mt-3 space-y-1 text-sm text-slate-600">
                      {t.category && <div><dt className="inline font-medium text-slate-500">Level: </dt><dd className="inline">{t.category}</dd></div>}
                      {t.dayTime && <div><dt className="inline font-medium text-slate-500">Practice: </dt><dd className="inline">{t.dayTime}</dd></div>}
                      {t.location && <div><dt className="inline font-medium text-slate-500">Where: </dt><dd className="inline">{t.location}</dd></div>}
                      <div><dt className="inline font-medium text-slate-500">Season fee: </dt><dd className="inline">{proration.prorated ? `${formatCents(proration.feeCents)} (prorated · ${proration.weeksRemaining} wks left)` : formatCents(feeCents)}</dd></div>
                    </dl>
                    <div className="mt-auto pt-4">
                      <Link href={`/register?team=${t.id}`} className="btn-primary w-full justify-center text-sm">Sign up for this team →</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-slate-500">Signing up covers the waiver, apparel, and the (prorated) season fee in one flow. You&apos;re placed on the team as soon as your payment clears.</p>
          </section>

          {/* ── Column 2: Subs needed ─────────────────────────────────────── */}
          <section id="subs">
            <h2 className="text-lg font-bold text-brand-900">Subs needed for practice / match</h2>
            <p className="mt-1 text-sm text-slate-600">
              Fill in for a single practice — <span className="font-semibold text-emerald-700">no charge</span>. Claim a spot, sign the quick waiver, and you&apos;re set. We&apos;ll text you the details and directions.
            </p>

            {subs.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                No subs needed right now — check back, teams post here when someone can&apos;t make a practice.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {subs.map((s) => (
                  <div key={s.sessionId} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-bold text-slate-900">{s.teamName}</h3>
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                        {s.spotsOpen} spot{s.spotsOpen === 1 ? "" : "s"} open
                      </span>
                    </div>
                    <dl className="mt-3 space-y-1 text-sm text-slate-600">
                      {s.category && <div><dt className="inline font-medium text-slate-500">Level: </dt><dd className="inline">{s.category}</dd></div>}
                      <div><dt className="inline font-medium text-slate-500">{s.type === "LEAGUE_MATCH" ? "Match" : "Practice"}: </dt><dd className="inline">{s.dateLabel} · {s.timeLabel}</dd></div>
                      {s.location && <div><dt className="inline font-medium text-slate-500">Where: </dt><dd className="inline">{s.location}</dd></div>}
                    </dl>
                    <details className="mt-4">
                      <summary className="btn-primary w-full cursor-pointer list-none justify-center text-sm [&::-webkit-details-marker]:hidden">Sub in for this {s.type === "LEAGUE_MATCH" ? "match" : "practice"} →</summary>
                      <form method="POST" action="/api/open-spots/claim" className="mt-3 grid gap-2 sm:grid-cols-2">
                        <input type="hidden" name="sessionId" value={s.sessionId} />
                        <input type="hidden" name="teamId" value={s.teamId} />
                        <input name="firstName" placeholder="First name" required className="input text-sm" />
                        <input name="lastName" placeholder="Last name" required className="input text-sm" />
                        <input name="email" type="email" placeholder="Email" className="input text-sm" />
                        <input name="phone" type="tel" placeholder="Mobile" className="input text-sm" />
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-medium text-slate-500">Date of birth</label>
                          <input name="dob" type="date" className="input text-sm" />
                        </div>
                        <p className="sm:col-span-2 text-xs text-slate-400">No charge. We&apos;ll text/email you the waiver and the practice details right away.</p>
                        <div className="sm:col-span-2"><button className="btn-accent w-full justify-center text-sm">Claim this spot</button></div>
                      </form>
                    </details>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-slate-500">Once you claim a spot you&apos;re on the team for that date only. You&apos;ll get the same practice reminders the team gets so you know exactly where to go.</p>
          </section>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
