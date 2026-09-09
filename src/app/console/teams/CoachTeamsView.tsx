import Link from "next/link";
import { formatTime12 } from "@/lib/time";
import { TeamColorDot } from "@/components/TeamColorDot";

// The coaches' Teams screen: two cards at the top — "My Teams" (the teams they
// coach, editable) and "All Teams" (everyone, read-only for teams they don't
// coach). Coaches never see the admin team-building board and can't create teams.

export type CoachTeamCard = {
  id: string;
  name: string;
  color: string | null;
  market: string | null;
  dayOfWeek: string | null;
  startTime: string | null;
  divisionName: string | null;
  facilityName: string | null;
  coachName: string | null;
  memberCount: number;
  memberNames: string[];
  launched: boolean;
};

const DAY_SHORT: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };

function meetLine(t: CoachTeamCard): string {
  const day = t.dayOfWeek ? DAY_SHORT[t.dayOfWeek] ?? t.dayOfWeek : null;
  const time = t.startTime ? formatTime12(t.startTime) : null;
  return [t.facilityName, [day, time].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "Day/time TBA";
}

export function CoachTeamsView({ teams, myTeamIds, tab }: { teams: CoachTeamCard[]; myTeamIds: string[]; tab: "mine" | "all" }) {
  const mine = new Set(myTeamIds);
  const myTeams = teams.filter((t) => mine.has(t.id));
  const shown = tab === "all" ? teams : myTeams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Teams</h1>
        <p className="text-sm text-slate-500">Your teams to run, and every team in the club to see.</p>
      </div>

      {/* The two cards: My Teams / All Teams. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/console/teams?tab=mine"
          className={`rounded-2xl border p-5 transition ${tab === "mine" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200" : "border-slate-200 bg-white hover:bg-slate-50"}`}
        >
          <div className="text-lg font-bold text-slate-900">My Teams</div>
          <div className="mt-0.5 text-sm text-slate-500">The teams you coach — open one to check players in, message, take notes, and manage its schedule.</div>
          <div className="mt-2 text-2xl font-bold text-brand-700">{myTeams.length}</div>
        </Link>
        <Link
          href="/console/teams?tab=all"
          className={`rounded-2xl border p-5 transition ${tab === "all" ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200" : "border-slate-200 bg-white hover:bg-slate-50"}`}
        >
          <div className="text-lg font-bold text-slate-900">All Teams</div>
          <div className="mt-0.5 text-sm text-slate-500">Every team in the club — coaches, rosters, and locations. View only; you can only edit teams you coach.</div>
          <div className="mt-2 text-2xl font-bold text-slate-700">{teams.length}</div>
        </Link>
      </div>

      {shown.length === 0 ? (
        <div className="card text-sm text-slate-500">
          {tab === "mine" ? "You're not assigned to any teams yet. An admin adds you as a team's coach." : "No teams yet."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((t) => {
            const canEdit = mine.has(t.id);
            return (
              <div key={t.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <TeamColorDot color={t.color} size={12} />
                    {t.name}
                  </h2>
                  {canEdit && <span className="badge bg-brand-100 text-brand-800">Your team</span>}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {[t.divisionName, t.market].filter(Boolean).join(" · ") || "—"}
                </div>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">Coach</dt><dd className="text-slate-700">{t.coachName ?? "—"}</dd></div>
                  <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">Meets</dt><dd className="text-slate-700">{meetLine(t)}</dd></div>
                  <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-400">Roster</dt><dd className="text-slate-700">{t.memberCount} player{t.memberCount === 1 ? "" : "s"}</dd></div>
                </dl>
                {t.memberNames.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.memberNames.map((n, i) => (
                      <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{n}</span>
                    ))}
                  </div>
                )}
                <div className="mt-auto pt-4">
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/console/teams/${t.id}/progress`} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">Check-ins &amp; notes</Link>
                      <Link href={`/console/teams/${t.id}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Open &amp; manage team</Link>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">View only — you don&apos;t coach this team.</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
