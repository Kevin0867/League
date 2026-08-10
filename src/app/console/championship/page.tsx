import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { Bracket, type BracketMatch } from "@/components/Bracket";
import { mintConsoleTicket } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERR_MESSAGES: Record<string, string> = {
  auth: "Not authorized to manage the championship.",
  division: "Division not found.",
  eligible: "Need at least two eligible teams to draw a bracket.",
  match: "Match not found.",
  teams: "Both teams must be set before recording a result.",
  winner: "Winner must be one of the two teams.",
};

export default async function ChampionshipPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  // Divisions across active seasons that have teams.
  const divisions = await prisma.division.findMany({
    where: { season: { active: true } },
    include: { season: true, teams: true },
    orderBy: { name: "asc" },
  });

  const allMatches = await prisma.championshipMatch.findMany();
  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  const teamNames: Record<string, string> = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  // Distinct active seasons that have championship divisions — each is one
  // tournament with a single start time (matches aren't separately scheduled).
  const seasonMap = new Map(divisions.map((d) => [d.seasonId, d.season]));
  const seasons = [...seasonMap.values()];
  const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const hhmm = (d: Date | null) => (d ? new Date(d).toISOString().slice(11, 16) : "09:00");

  return (
    <div className="space-y-6">
      <PageHeader title="Championship" subtitle="Championship week, Dec 7–13. Teams are seeded from division standings; the bracket is single-elimination and byes auto-advance." />

      {sp.ok === "bracket" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Bracket drawn.</div>
      )}
      {sp.ok === "result" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Result recorded.</div>
      )}
      {sp.ok === "start" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Tournament start time saved.</div>
      )}
      {sp.err && ERR_MESSAGES[sp.err] && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{ERR_MESSAGES[sp.err]}</div>
      )}

      {/* Tournament start — one time for the whole bracketed event */}
      {seasons.map((s) => (
        <div key={s.id} className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Tournament start — {s.name}</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {s.championshipStartsAt
                  ? `Starts ${new Date(s.championshipStartsAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}`
                  : "No start time set — the whole bracket plays from this time."}
              </p>
            </div>
            <form method="POST" action="/api/console/championship" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="setStart" />
              <input type="hidden" name="seasonId" value={s.id} />
              <div>
                <label className="label text-xs">Date</label>
                <input name="date" type="date" className="input py-1.5" defaultValue={iso(s.championshipStartsAt)} />
              </div>
              <div>
                <label className="label text-xs">Time</label>
                <input name="time" type="time" className="input py-1.5" defaultValue={hhmm(s.championshipStartsAt)} />
              </div>
              <button className="btn-secondary py-1.5 text-sm">Save</button>
            </form>
          </div>
        </div>
      ))}

      {divisions.filter((d) => d.teams.length > 0).length === 0 && (
        <p className="text-slate-500">No divisions with teams yet.</p>
      )}

      {divisions
        .filter((d) => d.teams.length > 0)
        .map((d) => {
          const matches = allMatches.filter((m) => m.divisionId === d.id) as unknown as BracketMatch[];
          const eligible = d.teams.filter((t) => t.champEligible).length;
          return (
            <div key={d.id} className="card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{d.name}</h2>
                  <p className="text-xs text-slate-400">
                    {d.season.name} · {eligible} eligible team{eligible === 1 ? "" : "s"}
                    {eligible < d.teams.length ? ` (${d.teams.length - eligible} ineligible)` : ""}
                  </p>
                </div>
                <form method="POST" action="/api/console/championship">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="generateBracket" />
                  <input type="hidden" name="divisionId" value={d.id} />
                  <button className="btn-secondary text-sm" disabled={eligible < 2}>
                    {matches.length > 0 ? "Redraw bracket" : "Draw bracket"}
                  </button>
                </form>
              </div>
              {matches.length > 0 ? (
                <Bracket matches={matches} teamNames={teamNames} editable ticket={ticket} />
              ) : (
                <p className="text-sm text-slate-400">
                  {eligible < 2 ? "Need at least two eligible teams to draw." : "Not drawn yet."}
                </p>
              )}
            </div>
          );
        })}
    </div>
  );
}
