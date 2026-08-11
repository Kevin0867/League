import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { coachAssignmentGate } from "@/lib/domain/teams";
import { formatTime12 } from "@/lib/time";
import { CoachProfileForm } from "@/components/CoachProfileForm";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";

function parseMarkets(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// `id` is the coach's personId, so coaches without a Coach profile row yet are
// still editable (the save upserts one).
export default async function EditCoachPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const { ok, err, team: clashTeam } = await searchParams;
  const session = await getSession();
  if (!session || !can(session.role, "manageCoaches")) redirect("/console");
  const ticket = await mintConsoleTicket();

  const person = await prisma.person.findUnique({
    where: { id },
    include: { coach: { include: { availabilityBlocks: { orderBy: { dayOfWeek: "asc" } } } } },
  });
  if (!person) redirect("/console/coaches?err=notfound");
  const coach = person.coach;

  // Team-assignment shortcut: the coach's current teams + teams still needing a
  // head coach, so hiring and deploying happen from one page.
  const gate = coach ? coachAssignmentGate(coach) : { ok: false, reasons: ["profile not saved yet"] };
  const [myTeams, openTeams] = coach
    ? await Promise.all([
        prisma.team.findMany({
          where: { coachId: coach.id },
          select: { id: true, name: true, dayOfWeek: true, startTime: true, season: { select: { name: true } } },
          orderBy: { name: "asc" },
        }),
        prisma.team.findMany({
          where: { coachId: null },
          select: { id: true, name: true, dayOfWeek: true, startTime: true, season: { select: { name: true, active: true } } },
          orderBy: [{ season: { active: "desc" } }, { name: "asc" }],
        }),
      ])
    : [[], []];
  const returnTo = `/console/coaches/${person.id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit coach — ${person.firstName} ${person.lastName}`}
        subtitle="Update certification, availability, and contact on this coach's behalf."
      />

      {coach && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Public coaches page</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {coach.publishedOnSite
                ? "Shown on the public /coaches page."
                : "Hidden from the public /coaches page. Publish only coaches confirmed for the season."}
            </p>
          </div>
          <form method="POST" action="/api/console/coaches">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="togglePublish" />
            <input type="hidden" name="personId" value={person.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className={coach.publishedOnSite ? "btn-secondary text-sm" : "btn-primary text-sm"}>
              {coach.publishedOnSite ? "Hide from site" : "Publish to site"}
            </button>
          </form>
        </div>
      )}
      <Link href="/console/coaches" className="text-sm text-slate-500 hover:underline">← Back to coaches</Link>
      {ok === "account" && (
        <div className="rounded-lg bg-accent-50 px-4 py-3 text-sm text-accent-800">
          Coach account created and an invite to set their password was emailed. Complete their profile below — certification, screening, markets, and day/time availability — then save.
        </div>
      )}
      {ok === "profile" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Coach profile saved.</div>
      )}
      {ok === "assignedCoach" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Coach assigned to the team.</div>
      )}
      {ok === "clearedCoach" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Coach removed from the team.</div>
      )}
      {err === "coachclash" && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          That team&apos;s day/time overlaps another team this coach holds{clashTeam ? ` (${clashTeam})` : ""}. Assign it from Coach matching if you need to override.
        </div>
      )}
      {err === "coach" && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Couldn&apos;t assign — the coach isn&apos;t cleared for assignment yet (background check + onboarding).
        </div>
      )}

      {/* Team assignments — deploy this coach without leaving their profile */}
      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold text-slate-900">Team assignments</h2>
          <p className="text-sm text-slate-500">Assign this coach to a team that still needs a head coach.</p>
        </div>

        {myTeams.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Currently coaching</div>
            <ul className="divide-y divide-slate-100 text-sm">
              {myTeams.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <div>
                    <Link href={`/console/teams/${t.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">{t.name}</Link>
                    <span className="ml-2 text-xs text-slate-400">
                      {t.season?.name}{t.dayOfWeek ? ` · ${t.dayOfWeek} ${formatTime12(t.startTime)}` : ""}
                    </span>
                  </div>
                  <ConfirmSubmit
                    action="/api/console/teams"
                    fields={{ ticket, op: "assignCoach", teamId: t.id, coachId: "", returnTo }}
                    confirm={`Remove ${person.firstName} as head coach of "${t.name}"?`}
                    label="Remove"
                    className="text-xs text-rose-600 hover:underline"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {!coach ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Save the coach&apos;s profile first to enable team assignment.</p>
        ) : !gate.ok ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Not cleared for assignment yet: {gate.reasons.join(", ")}. Complete screening above to enable it.
          </p>
        ) : openTeams.length === 0 ? (
          <p className="text-sm text-slate-400">No teams are waiting for a head coach right now.</p>
        ) : (
          <form method="POST" action="/api/console/teams" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="assignCoach" />
            <input type="hidden" name="coachId" value={coach.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="min-w-[16rem] flex-1">
              <label className="label">Assign to a team</label>
              <select name="teamId" className="input" defaultValue="" required>
                <option value="" disabled>Choose a team…</option>
                {openTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.season?.active ? "" : ` (${t.season?.name})`}{t.dayOfWeek ? ` — ${t.dayOfWeek} ${formatTime12(t.startTime)}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary">Assign</button>
          </form>
        )}
      </section>

      <CoachProfileForm
        ticket={ticket}
        email={person.email ?? ""}
        targetPersonId={person.id}
        initial={{
          phone: person.phone ?? "",
          rpoCertLevel: coach?.rpoCertLevel ?? "",
          certifications: coach?.certifications ?? "",
          bio: coach?.bio ?? "",
          coachingLevels: coach?.coachingLevels ?? "",
          markets: parseMarkets(coach?.marketsCovered ?? null),
          availability: (coach?.availabilityBlocks ?? []).map((b) => ({
            dayOfWeek: b.dayOfWeek,
            startTime: b.startTime,
            endTime: b.endTime,
          })),
          safeSport: coach?.safeSportCertified ?? false,
          backgroundCheck: !!coach?.backgroundCheckDate,
          backgroundCheckDate: coach?.backgroundCheckDate ? new Date(coach.backgroundCheckDate).toISOString().slice(0, 10) : "",
          backgroundCheckCompany: coach?.backgroundCheckCompany ?? "",
        }}
        pay={{
          seasonRate: coach?.seasonPayCents != null ? (coach.seasonPayCents / 100).toFixed(2) : "",
          seasonPct: coach?.seasonPayPct != null ? String(coach.seasonPayPct) : "",
          lessonRate: coach?.lessonPayCents != null ? (coach.lessonPayCents / 100).toFixed(2) : "",
          lessonPct: coach?.lessonPayPct != null ? String(coach.lessonPayPct) : "",
          clinicRate: coach?.clinicPayCents != null ? (coach.clinicPayCents / 100).toFixed(2) : "",
          clinicPct: coach?.clinicPayPct != null ? String(coach.clinicPayPct) : "",
          notes: coach?.payNotes ?? "",
        }}
      />
    </div>
  );
}
