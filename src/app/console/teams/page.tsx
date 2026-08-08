import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import {
  teamMissingFields,
  rosterStatus,
  canPublishTeam,
} from "@/lib/domain/teams";
import { TEAM_CAP, TEAM_MIN } from "@/lib/enums";

export const dynamic = "force-dynamic";

export default async function TeamBuildBoard() {
  const teams = await prisma.team.findMany({
    include: {
      _count: { select: { members: true } },
      coach: { include: { person: true } },
      facility: true,
      division: true,
    },
    orderBy: [{ market: "asc" }, { name: "asc" }],
  });

  const ready = teams.filter((t) => teamMissingFields(t).length === 0).length;
  const published = teams.filter((t) => t.published).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Team build board</h1>
          <p className="text-slate-500">
            Every team&apos;s six fields and completion status. Cap {TEAM_CAP}, minimum {TEAM_MIN}.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Pill label="Teams" value={teams.length} />
          <Pill label="Ready" value={ready} tone="emerald" />
          <Pill label="Published" value={published} tone="brand" />
        </div>
      </div>

      {teams.length === 0 ? (
        <div className="card">
          <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No teams yet. Teams are formed by assigning registered players out of
            division × location × time pools. (Pool view &amp; assignment engine
            is the next slice.)
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => {
            const missing = teamMissingFields(t);
            const roster = rosterStatus(t._count.members, t.coachPlays);
            const publish = canPublishTeam(t, t.facility);
            return (
              <div key={t.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{t.name}</h3>
                    <p className="text-xs text-slate-400">
                      {t.origin === "ACP_CLUB" ? t.clubName ?? "Outside club" : "PURE Academy"}
                    </p>
                  </div>
                  {t.published ? (
                    <StatusBadge status="PUBLISHED" />
                  ) : missing.length === 0 ? (
                    <span className="badge bg-emerald-100 text-emerald-800">ready</span>
                  ) : (
                    <span className="badge bg-amber-100 text-amber-800">building</span>
                  )}
                </div>

                {/* Six fields */}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <Field label="Division" value={t.division?.name} />
                  <Field label="Level band" value={t.levelBand} />
                  <Field label="Market" value={t.market} />
                  <Field label="Coach" value={t.coach ? `${t.coach.person.firstName} ${t.coach.person.lastName}` : t.origin === "ACP_CLUB" ? "n/a (contact)" : null} />
                  <Field label="Facility" value={t.facility?.name} />
                  <Field label="Day / time" value={t.dayOfWeek ? `${t.dayOfWeek} ${t.startTime ?? ""}` : null} />
                </dl>

                {/* Roster meter */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Roster {roster.effective}/{TEAM_CAP}{t.coachPlays ? " (coach plays)" : ""}</span>
                    <span>{roster.meetsMinimum ? "min met" : `need ${roster.needed}`}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full ${roster.meetsMinimum ? "bg-emerald-500" : "bg-amber-400"}`}
                      style={{ width: `${Math.min(100, (roster.effective / TEAM_CAP) * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Gates */}
                <div className="mt-3 space-y-1 text-xs">
                  {missing.length > 0 && (
                    <p className="text-amber-700">Missing: {missing.join(", ")}</p>
                  )}
                  {!publish.ok && (
                    <p className="text-slate-500">🔒 {publish.reason}</p>
                  )}
                  {publish.ok && !t.published && (
                    <p className="text-emerald-700">✓ Eligible to publish to families</p>
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

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={value ? "font-medium text-slate-800" : "text-amber-600"}>
        {value ?? "— missing"}
      </dd>
    </div>
  );
}

function Pill({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "emerald" | "brand" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-800",
    brand: "bg-brand-100 text-brand-800",
  };
  return (
    <div className={`rounded-lg px-3 py-1.5 ${tones[tone]}`}>
      <span className="font-bold">{value}</span> <span className="text-xs">{label}</span>
    </div>
  );
}
