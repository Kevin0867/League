import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatTime12 } from "@/lib/time";
import { getTeamPageData, type TeamFixtureView } from "@/lib/domain/teamPage";

export const dynamic = "force-dynamic";

const COLOR_DOT: Record<string, string> = {
  Blue: "bg-blue-500", Green: "bg-emerald-500", Red: "bg-rose-500",
  Yellow: "bg-yellow-400", Orange: "bg-orange-500", Purple: "bg-purple-500",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getTeamPageData(slug);
  if (!data) return { title: { absolute: "Team — PURE Academy" } };
  return {
    title: { absolute: `${data.displayName} — PURE Academy` },
    description: `${data.displayName}: roster, weekly practice, league record, and schedule.`,
    alternates: { canonical: `/teams/${slug}` },
  };
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getTeamPageData(slug);
  if (!data) notFound();

  const rec = data.record;

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/teams" className="text-sm text-slate-500 hover:text-brand-700 hover:underline">
          ← All teams
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {data.color && (
            <span className={`h-8 w-8 shrink-0 rounded-full ${COLOR_DOT[data.color] ?? "bg-slate-300"}`} title={data.color} />
          )}
          <h1 className="display text-3xl text-brand-900 sm:text-4xl">{data.displayName}</h1>
        </div>
        <p className="mt-2 text-slate-600">
          {[data.shortMarket && `PURE ${data.shortMarket}`, data.divisionCode].filter(Boolean).join(" · ") ||
            "PURE Academy team"}
        </p>

        {/* Record */}
        {rec && (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat value={`${rec.matchesWon}–${rec.matchesLost}`} label="Match record" />
            <Stat value={`${rec.linesWon}–${rec.linesLost}`} label="Lines won–lost" />
            <Stat
              value={(() => { const d = rec.pointsFor - rec.pointsAgainst; return d > 0 ? `+${d}` : `${d}`; })()}
              label="Point differential"
            />
            <Stat value={rec.points} label="League points" />
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Left: practice + coach + roster */}
          <div className="space-y-6 lg:col-span-1">
            <div className="card">
              <h2 className="font-semibold text-slate-900">Weekly practice</h2>
              {data.practice.day || data.practice.startTime || data.practice.facility ? (
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {data.practice.day && <li><span className="text-slate-400">Day:</span> {data.practice.day}</li>}
                  {data.practice.startTime && <li><span className="text-slate-400">Time:</span> {formatTime12(data.practice.startTime)}</li>}
                  {data.practice.facility && <li><span className="text-slate-400">Site:</span> {data.practice.facility}</li>}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Practice details shared with rostered players.</p>
              )}
              {data.coachName && (
                <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
                  <span className="text-slate-400">Coach:</span>{" "}
                  {data.coachPersonId ? (
                    <Link href={`/coaches/${data.coachPersonId}`} className="font-medium text-brand-700 hover:underline">{data.coachName}</Link>
                  ) : (
                    data.coachName
                  )}
                </p>
              )}
            </div>

            <div className="card">
              <h2 className="font-semibold text-slate-900">Roster</h2>
              {data.roster.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Roster is being finalized.</p>
              ) : (
                <>
                  <ul className="mt-2 grid grid-cols-1 gap-1 text-sm text-slate-700">
                    {data.roster.map((p) => (
                      <li key={p.id}>
                        <Link href={`/players/${p.slug}`} className="text-slate-700 hover:text-brand-700 hover:underline">{p.label}</Link>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-slate-400">{data.roster.length} players</p>
                </>
              )}
            </div>
          </div>

          {/* Right: schedule */}
          <div className="space-y-6 lg:col-span-2">
            <div className="card">
              <h2 className="font-semibold text-slate-900">Upcoming</h2>
              {data.upcoming.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No upcoming fixtures scheduled.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.upcoming.map((f) => <FixtureRow key={f.id} f={f} />)}
                </ul>
              )}
            </div>

            {data.recent.length > 0 && (
              <div className="card">
                <h2 className="font-semibold text-slate-900">Recent results</h2>
                <ul className="mt-3 space-y-2">
                  {data.recent.map((f) => <FixtureRow key={f.id} f={f} />)}
                </ul>
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 text-sm text-slate-500">
          See the full <Link href="/standings" className="text-brand-700 hover:underline">standings</Link> and{" "}
          <Link href="/schedule" className="text-brand-700 hover:underline">schedule</Link>.
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}

function FixtureRow({ f }: { f: TeamFixtureView }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="text-slate-800">
          <span className="text-slate-400">{f.isHome ? "vs" : "@"}</span>{" "}
          {f.opponentSlug ? (
            <Link href={`/teams/${f.opponentSlug}`} className="font-medium hover:text-brand-700 hover:underline">
              {f.opponentName}
            </Link>
          ) : (
            <span className="font-medium">{f.opponentName}</span>
          )}
        </div>
        <div className="text-xs text-slate-400">
          Week {f.weekNumber} · {formatDate(f.scheduledAt)}
          {f.facilityName ? ` · ${f.facilityName}` : ""}
        </div>
      </div>
      <StatusBadge status={f.status} />
    </li>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
      <div className="text-2xl font-extrabold text-brand-900 tabular-nums">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
