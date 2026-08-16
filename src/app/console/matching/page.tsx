import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { coachAssignmentGate } from "@/lib/domain/teams";
import { formatTime12, formatTimeRange12 } from "@/lib/time";
import { requireAdmin } from "@/lib/rbac";
import { MatchingBoard, type MatchTeam } from "./MatchingBoard";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  assignedCoach: "Coach assigned to the program.",
  clearedCoach: "Coach removed from the program.",
  bulkCoaches: "Coach assignments saved.",
};
const ERR: Record<string, string> = {
  auth: "Not authorized.",
  team: "Team not found.",
  coach: "That coach can't be assigned — not cleared (background check required).",
  coachclash: "That coach already coaches another team at this day/time — pick a non-overlapping slot.",
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

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const [teams, coachRows] = await Promise.all([
    prisma.team.findMany({
      where: { season: { active: true } },
      include: {
        division: true,
        facility: true,
        coach: { include: { person: true } },
        season: true,
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.coach.findMany({
      include: { person: true, availabilityBlocks: true, _count: { select: { teams: true } } },
      orderBy: { person: { lastName: "asc" } },
    }),
  ]);

  // Precompute each coach's availability snapshot.
  const coaches = coachRows.map((c) => {
    const gate = coachAssignmentGate(c);
    const markets = parseMarkets(c.marketsCovered);
    const days = [...new Set(c.availabilityBlocks.map((b) => b.dayOfWeek))];
    return {
      id: c.id,
      name: `${c.person.firstName} ${c.person.lastName}`,
      cleared: gate.ok,
      reasons: gate.reasons,
      levels: c.coachingLevels ?? "",
      markets,
      days,
      blocks: c.availabilityBlocks,
      teamCount: c._count.teams,
    };
  });

  function matchFor(coach: (typeof coaches)[number], team: (typeof teams)[number]) {
    const teamMarket = team.facility?.market ?? team.market ?? null;
    const marketMatch = teamMarket ? coach.markets.includes(teamMarket) : false;
    const dayMatch = team.dayOfWeek ? coach.days.includes(team.dayOfWeek) : false;
    return { marketMatch, dayMatch, teamMarket };
  }

  // Serializable shape for the client bulk-save board: each team with its
  // ranked coach options (cleared first, then location, then day) and top
  // suggestions.
  const matchTeams: MatchTeam[] = teams.map((team) => {
    const teamMarket = team.facility?.market ?? team.market ?? null;
    const ranked = [...coaches]
      .map((c) => ({ c, m: matchFor(c, team) }))
      .sort((a, b) =>
        Number(b.c.cleared) - Number(a.c.cleared) ||
        Number(b.m.marketMatch) - Number(a.m.marketMatch) ||
        Number(b.m.dayMatch) - Number(a.m.dayMatch) ||
        a.c.name.localeCompare(b.c.name)
      );
    return {
      id: team.id,
      name: team.name,
      meta: `${team.division?.name ?? team.levelBand ?? "Level TBD"} · ${team.facility?.name ?? teamMarket ?? "Location TBD"}${team.dayOfWeek ? ` · ${team.dayOfWeek}${team.startTime ? ` ${formatTime12(team.startTime)}` : ""}` : ""}`,
      coachId: team.coachId ?? null,
      options: ranked.map(({ c, m }) => ({ id: c.id, name: c.name, cleared: c.cleared, marketMatch: m.marketMatch, dayMatch: m.dayMatch })),
      suggestions: ranked
        .filter((r) => r.c.cleared && r.m.marketMatch && r.m.dayMatch && r.c.id !== team.coachId)
        .slice(0, 3)
        .map((r) => ({ id: r.c.id, name: r.c.name })),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coach matching"
        subtitle="See each coach's availability, and assign or move a coach to a program and location. Suggestions flag coaches whose location and day fit the program."
      />

      {sp.ok && OK[sp.ok] && (
        <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">
          {sp.ok === "bulkCoaches" && sp.n ? `Saved ${sp.n} coach change${sp.n === "1" ? "" : "s"}.` : OK[sp.ok]}
          {sp.skipped ? <span className="text-rose-700"> Skipped (not cleared or a day/time clash): {sp.skipped}.</span> : null}
        </p>
      )}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERR[sp.err] ?? "Something went wrong."}</p>}

      {/* Assign coaches to programs — one dirty set, one Save (MatchingBoard). */}
      <section className="space-y-3">
        <h2 className="h-sport text-lg">Programs</h2>
        {teams.length === 0 ? (
          <div className="card text-sm text-slate-500">No active-season teams yet. Build teams first, then assign coaches here.</div>
        ) : (
          <MatchingBoard ticket={ticket} teams={matchTeams} />
        )}
      </section>

      {/* Coach availability reference */}
      <section className="space-y-3">
        <h2 className="h-sport text-lg">Coach availability</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2">Coach</th>
                <th>Status</th>
                <th>Levels</th>
                <th>Locations</th>
                <th>Days available</th>
                <th className="text-right">Programs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coaches.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 font-medium text-slate-800">{c.name}</td>
                  <td>
                    {c.cleared
                      ? <span className="badge bg-emerald-100 text-emerald-800">cleared</span>
                      : <span className="badge bg-amber-100 text-amber-800" title={c.reasons.join(", ")}>not cleared</span>}
                  </td>
                  <td className="text-slate-600">{c.levels || <span className="text-slate-400">—</span>}</td>
                  <td className="text-slate-600">{c.markets.length ? c.markets.join(", ") : <span className="text-slate-400">—</span>}</td>
                  <td className="text-slate-600">
                    {c.blocks.length
                      ? c.blocks.map((b) => `${b.dayOfWeek} ${formatTimeRange12(b.startTime, b.endTime)}`).join(", ")
                      : <span className="text-slate-400">not set</span>}
                  </td>
                  <td className="text-right text-slate-600">{c.teamCount}</td>
                </tr>
              ))}
              {coaches.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400">No coaches yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">
          Coaches set their locations, levels, and day/time availability in their profile. A program shows{" "}
          <span className="font-medium">✓location</span> / <span className="font-medium">✓day</span> where the coach fits.
          Only cleared coaches (background check) can be assigned.
        </p>
      </section>
    </div>
  );
}
