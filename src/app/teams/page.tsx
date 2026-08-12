import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { prisma } from "@/lib/db";
import { teamDisplayName, teamShortName, teamSlug, PURE_MARKETS } from "@/lib/domain/teamName";
import { leagueWeekLabel } from "@/lib/domain/seasonCalendar";
import { formatDate } from "@/lib/time";
import { TeamsFilter } from "@/components/TeamsFilter";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Our Teams — PURE Academy" },
  description: "Every PURE Academy team across the Valley, by market and division.",
  alternates: { canonical: "/teams" },
};

const COLOR_DOT: Record<string, string> = {
  Blue: "bg-blue-500", Green: "bg-emerald-500", Red: "bg-rose-500",
  Yellow: "bg-yellow-400", Orange: "bg-orange-500", Purple: "bg-purple-500",
};

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    where: { club: "PURE", published: true },
    include: { _count: { select: { members: true } } },
    orderBy: [{ market: "asc" }, { divisionCode: "asc" }, { color: "asc" }],
  });

  // Club-wide record — numbers that only exist because the club is bigger than
  // one team.
  const markets = new Set(teams.map((t) => t.market).filter(Boolean));
  const players = teams.reduce((n, t) => n + t._count.members, 0);
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
  const teamIdentity = { club: true, market: true, divisionCode: true, color: true } as const;
  const [gamesPlayed, ratedPlayers, gamesToDupr, fixtures] = await Promise.all([
    prisma.fixture.count({ where: { status: "COMPLETED" } }),
    prisma.person.count({ where: { duprVerified: true } }),
    prisma.duprSubmission.count({ where: { status: "SUBMITTED" } }),
    season
      ? prisma.fixture.findMany({
          where: { seasonId: season.id, homeTeamId: { not: null }, awayTeamId: { not: null } },
          include: {
            homeTeam: { select: teamIdentity },
            awayTeam: { select: teamIdentity },
            lines: { select: { isCounting: true, lineWinner: true } },
          },
          orderBy: [{ scheduledAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  // This-week / recent across the whole Academy — every division on one page.
  const upcoming = fixtures.filter((f) => ["SCHEDULED", "CONFIRMED", "RESCHEDULED"].includes(f.status)).slice(0, 6);
  const recent = fixtures.filter((f) => ["COMPLETED", "FORFEITED"].includes(f.status)).reverse().slice(0, 8);
  const lineTally = (f: (typeof fixtures)[number]) => {
    let home = 0, away = 0;
    for (const l of f.lines) {
      if (!l.isCounting) continue;
      if (l.lineWinner === "HOME") home++;
      else if (l.lineWinner === "AWAY") away++;
    }
    return { home, away };
  };

  // Group by market, in the canonical market order.
  const byMarket = new Map<string, typeof teams>();
  for (const t of teams) {
    const key = t.market ?? "Other";
    (byMarket.get(key) ?? byMarket.set(key, []).get(key)!).push(t);
  }
  const orderedMarkets = [...PURE_MARKETS, "Other"].filter((m) => byMarket.has(m));
  const filterMarkets = orderedMarkets.filter((m) => m !== "Other");
  const divisions = [...new Set(teams.map((t) => t.divisionCode).filter((d): d is string => !!d))].sort();

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-6xl px-4 py-12">
        <p className="eyebrow">The club</p>
        <h1 className="display mt-3 text-3xl text-brand-900 sm:text-4xl">
          One club, <em className="text-accent-600">every court</em>
        </h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Every PURE Academy team across the Valley. A 2.5 beginner in Gilbert and a 5.0 competitor in Mesa play
          for the same club.
        </p>

        {/* Club-wide record */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat value={teams.length} label="Teams fielded" />
          <Stat value={markets.size} label="Markets" />
          <Stat value={players} label="Players" />
          <Stat value={gamesPlayed > 0 ? gamesPlayed : ratedPlayers} label={gamesPlayed > 0 ? "Matches played" : "DUPR-rated players"} />
        </div>
        {gamesToDupr > 0 && (
          <p className="mt-2 text-xs text-slate-400">{gamesToDupr} match{gamesToDupr === 1 ? "" : "es"} recorded to DUPR this season.</p>
        )}

        {/* This week / coming up across the Academy */}
        {upcoming.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">This week across the Academy</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {upcoming.map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm">
                  <span className="min-w-0 truncate text-slate-700">
                    <Link href={`/teams/${teamSlug(f.homeTeam!)}`} className="hover:text-brand-700 hover:underline">{teamShortName(f.homeTeam!)}</Link>
                    <span className="text-slate-400"> vs </span>
                    <Link href={`/teams/${teamSlug(f.awayTeam!)}`} className="hover:text-brand-700 hover:underline">{teamShortName(f.awayTeam!)}</Link>
                  </span>
                  <span className="ml-3 shrink-0 text-xs text-slate-400">Wk {leagueWeekLabel(f.weekNumber)} · {formatDate(f.scheduledAt)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent results across every division */}
        {recent.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Recent results</h2>
            <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
              {recent.map((f) => {
                const { home, away } = lineTally(f);
                const homeWon = home > away;
                const tie = home === away;
                return (
                  <div key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="min-w-0 truncate">
                      <Link href={`/teams/${teamSlug(f.homeTeam!)}`} className={`hover:underline ${homeWon ? "font-semibold text-slate-900" : "text-slate-600"}`}>{teamShortName(f.homeTeam!)}</Link>
                      <span className="mx-1.5 tabular-nums text-slate-400">{home}–{away}</span>
                      <Link href={`/teams/${teamSlug(f.awayTeam!)}`} className={`hover:underline ${!homeWon && !tie ? "font-semibold text-slate-900" : "text-slate-600"}`}>{teamShortName(f.awayTeam!)}</Link>
                    </span>
                    <span className="ml-3 shrink-0 text-xs text-slate-400">Wk {leagueWeekLabel(f.weekNumber)}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Full <Link href="/standings" className="text-brand-700 hover:underline">standings</Link> by division.
            </p>
          </section>
        )}

        {teams.length === 0 ? (
          <p className="mt-10 rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
            Teams are published to families in Week 2. Check back soon.
          </p>
        ) : (
          <>
          {(filterMarkets.length > 1 || divisions.length > 1) && (
            <TeamsFilter markets={filterMarkets} divisions={divisions} />
          )}
          <div className="mt-6 space-y-8">
            {orderedMarkets.map((market) => (
              <section key={market} data-market-section={market}>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  {market === "Other" ? "Other" : `PURE ${market}`}
                </h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {byMarket.get(market)!.map((t) => (
                    <Link
                      key={t.id}
                      href={`/teams/${teamSlug(t)}`}
                      data-team-card
                      data-market={t.market ?? ""}
                      data-division={t.divisionCode ?? ""}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-brand-300 hover:shadow"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">{teamDisplayName(t)}</div>
                        <div className="text-xs text-slate-500">{teamShortName(t)} · {t._count.members} players</div>
                      </div>
                      {t.color && <span className={`h-4 w-4 shrink-0 rounded-full ${COLOR_DOT[t.color] ?? "bg-slate-300"}`} title={t.color} />}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
          </>
        )}

        <p className="mt-10 text-sm text-slate-500">
          Following the league? See <Link href="/standings" className="text-brand-700 hover:underline">standings</Link> and{" "}
          <Link href="/schedule" className="text-brand-700 hover:underline">schedule</Link>.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
      <div className="text-3xl font-extrabold text-brand-900 tabular-nums">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
