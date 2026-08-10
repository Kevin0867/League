import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { teamConfirmation, shouldEscalate, MIN_CONFIRMED_PLAYERS } from "@/lib/domain/availability";
import { EditableFixtureRow } from "@/components/EditableFixtureRow";

export const dynamic = "force-dynamic";

const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
const hhmm = (d: Date) => new Date(d).toISOString().slice(11, 16);

const OK: Record<string, string> = {
  generateFixtures: "Fixtures generated.",
  editFixture: "Fixture updated.",
  clearFixtures: "Fixtures cleared — regenerate when ready.",
  sendMatchNotice: "7-day match notice sent.",
  sendEscalationAlert: "48-hour alert sent.",
};

const ERRORS: Record<string, string> = {
  auth: "Not authorized to manage the league.",
  noseason: "No ACP season found.",
  nofixture: "Fixture not found.",
  norisk: "No teams are currently at risk — nothing to escalate.",
  op: "Unknown operation.",
};

export default async function LeaguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const season = await prisma.season.findFirst({ where: { active: true, program: "ACP" } });
  const facilities = await prisma.facility.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const acpTeamCount = season ? await prisma.team.count({ where: { seasonId: season.id } }) : 0;

  const fixtures = await prisma.fixture.findMany({
    where: season ? { seasonId: season.id } : {},
    include: {
      homeTeam: { include: { members: true, division: true } },
      awayTeam: { include: { members: true } },
      facility: true,
      confirmations: true,
    },
    orderBy: [{ weekNumber: "asc" }, { scheduledAt: "asc" }],
    take: 200,
  });

  const now = new Date();
  const totalTeams = await prisma.team.count({ where: season ? { seasonId: season.id } : {} });

  // Confirmation status per fixture (for the current/near window).
  const withStatus = fixtures.map((f) => {
    const teams = [f.homeTeam, f.awayTeam].filter(Boolean).map((team) => {
      const statuses = team!.members.map(
        (m) => f.confirmations.find((c) => c.personId === m.personId)?.status ?? "UNCONFIRMED"
      );
      const tc = teamConfirmation(team!.id, team!.name, team!.members.length, statuses);
      return { ...tc, atRisk: shouldEscalate(f.scheduledAt, now, tc) };
    });
    return { fixture: f, teams, anyRisk: teams.some((t) => t.atRisk) };
  });

  const upcoming = withStatus.filter(
    (w) => w.fixture.scheduledAt.getTime() > now.getTime() - 6 * 3.6e6 &&
      ["SCHEDULED", "CONFIRMED", "RESCHEDULED"].includes(w.fixture.status)
  );

  return (
    <div className="space-y-6">
      <PageHeader title="ACP League" subtitle="Doubles-only, three ranked lines, DUPR-recorded. Fixtures across five league weeks; 48-hour confirmation with escalation." />

      {sp.ok && (
        <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OK[sp.ok] ?? "Done."}</p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>
      )}

      {/* Guided league setup */}
      {(() => {
        const steps = [
          { done: !!season, label: "Activate an Arizona Club Pickleball (ACP) season", href: "/console/setup", cta: "Season Setup" },
          { done: acpTeamCount >= 2, label: "Have at least two ACP teams", href: "/console/teams", cta: "Team Build" },
          { done: fixtures.length > 0, label: "Generate the fixture schedule", href: null, cta: "Generate below" },
          { done: fixtures.some((f) => f.status !== "SCHEDULED"), label: "Run match nights & confirmations", href: null, cta: "" },
        ];
        const next = steps.find((s) => !s.done);
        return (
          <div className="card border-l-4 border-brand-500">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-brand-900">League setup</h2>
                {next ? (
                  <p className="mt-0.5 text-sm text-slate-600">Next: <span className="font-medium text-slate-800">{next.label}</span></p>
                ) : (
                  <p className="mt-0.5 text-sm text-emerald-700">Your league is up and running. 🎉</p>
                )}
              </div>
              {next?.href && <Link href={next.href} className="btn-primary text-sm">{next.cta} →</Link>}
            </div>
            <ol className="mt-3 space-y-2 text-sm">
              {steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${s.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{s.done ? "✓" : i + 1}</span>
                  <span className={s.done ? "text-slate-500 line-through" : "text-slate-700"}>{s.label}</span>
                  {!s.done && s.href && <Link href={s.href} className="text-xs text-accent-700 underline">{s.cta}</Link>}
                </li>
              ))}
            </ol>
          </div>
        );
      })()}

      {!season && (
        <div className="card text-sm text-slate-600">
          No active ACP season yet. Create and activate an <span className="font-medium">Arizona Club Pickleball</span> season
          in <Link href="/console/setup" className="text-accent-700 underline">Season Setup</Link>, then come back to generate fixtures.
        </div>
      )}

      {/* Generate fixtures */}
      {season && fixtures.length === 0 && (
        <div className="card">
          <h2 className="mb-1 font-semibold text-slate-900">Generate fixtures</h2>
          <p className="mb-3 text-sm text-slate-500">
            Round-robin across five league weeks from {season.startDate.toLocaleDateString()}, skipping
            blackout weeks and the Dec 5–6 weekend. {totalTeams} team(s) in the season.
          </p>
          <form method="POST" action="/api/console/league">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="generateFixtures" />
            <input type="hidden" name="seasonId" value={season.id} />
            <button className="btn-primary">Generate fixtures</button>
          </form>
        </div>
      )}

      {/* 48-hour confirmation dashboard */}
      {upcoming.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-900">Confirmation dashboard</h2>
          <p className="mb-3 text-sm text-slate-500">
            Every fixture&apos;s confirmed players. A team below {MIN_CONFIRMED_PLAYERS} confirmed inside 48
            hours is at risk of forfeit — alert the coach, Director, and COO.
          </p>
          <div className="space-y-3">
            {upcoming.map(({ fixture: f, teams, anyRisk }) => (
              <div key={f.id} className={`rounded-lg border p-3 ${anyRisk ? "border-rose-300 bg-rose-50/40" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-slate-800">{f.homeTeam?.name} vs {f.awayTeam?.name}</span>
                    <span className="ml-2 text-xs text-slate-400">Wk {f.weekNumber} · {f.scheduledAt.toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <form method="POST" action="/api/console/league">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="sendMatchNotice" />
                      <input type="hidden" name="fixtureId" value={f.id} />
                      <button className="btn-ghost text-xs">Send 7-day notice</button>
                    </form>
                    {anyRisk && (
                      <form method="POST" action="/api/console/league">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="sendEscalationAlert" />
                        <input type="hidden" name="fixtureId" value={f.id} />
                        <button className="btn-secondary text-xs text-rose-700 ring-rose-200 hover:bg-rose-50">Send 48h alert</button>
                      </form>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {teams.map((t) => (
                    <div key={t.teamId} className="flex items-center justify-between rounded bg-white px-3 py-2 text-sm ring-1 ring-slate-100">
                      <span className="text-slate-700">{t.teamName}</span>
                      <span className="flex items-center gap-2 text-xs">
                        <span className={t.enough ? "text-emerald-700" : "text-rose-700 font-medium"}>
                          {t.confirmedPlaying}/{MIN_CONFIRMED_PLAYERS} playing
                        </span>
                        <span className="text-slate-400">{t.unconfirmed} unconfirmed</span>
                        {t.atRisk && <span className="badge bg-rose-100 text-rose-800">at risk</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All fixtures */}
      <div className="card overflow-x-auto">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Fixtures</h2>
          {season && fixtures.length > 0 && (
            <form method="POST" action="/api/console/league">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="clearFixtures" />
              <input type="hidden" name="seasonId" value={season.id} />
              <button className="text-xs text-rose-600 hover:underline">Clear &amp; regenerate</button>
            </form>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr><th className="py-2">Wk</th><th>Date</th><th>Home</th><th>Away</th><th>Hub</th><th>Status</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {fixtures.map((f) => (
              <EditableFixtureRow
                key={f.id}
                ticket={ticket}
                facilities={facilities}
                fixture={{
                  id: f.id,
                  weekNumber: f.weekNumber,
                  dateISO: iso(f.scheduledAt),
                  timeHHMM: hhmm(f.scheduledAt),
                  dateLabel: f.scheduledAt.toLocaleDateString(),
                  home: f.homeTeam?.name ?? "TBD",
                  away: f.awayTeam?.name ?? "TBD",
                  facilityId: f.facilityId ?? null,
                  facilityName: f.facility?.name ?? "—",
                  status: f.status,
                }}
              />
            ))}
            {fixtures.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400">No fixtures generated yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
