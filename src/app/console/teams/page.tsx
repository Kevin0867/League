import Link from "next/link";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTime12 } from "@/lib/time";
import {
  teamMissingFields,
  rosterStatus,
  canPublishTeam,
} from "@/lib/domain/teams";
import { TEAM_CAP, WEEKDAYS } from "@/lib/enums";
import { getSeasonStats } from "@/lib/domain/seasonStats";
import { RosteringTabs } from "@/components/RosteringTabs";
import { TeamCreateForm } from "./TeamCreateForm";
import { BulkScheduleEditor } from "./BulkScheduleEditor";
import { deriveDivisionCode } from "@/lib/domain/teamName";
import { TeamColorDot } from "@/components/TeamColorDot";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { TableFilter } from "@/components/TableFilter";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = { createTeam: "Team created.", deleteTeam: "Team deleted — players returned to the pool.", schedule: "Day, time, and facility saved. Generate practices on the Schedule page.", colors: "Team colors assigned — one distinct color per gender+level group.", merged: "Duplicate teams merged — players consolidated onto the kept team." };
const ERRORS: Record<string, string> = {
  fields: "Team name and season are required.",
  auth: "You don't have permission to manage teams.",
  colorclash: "Another team in that division already uses that color — each team in a division needs a distinct color.",
};

export default async function TeamBuildBoard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  // Headline counts + checklist come from the one counting service (same source
  // as the dashboard); the build board below shows this season's real teams.
  const stats = await getSeasonStats();
  const teams = await prisma.team.findMany({
    where: stats.season ? { seasonId: stats.season.id, isTest: false } : { id: "__none__" },
    include: {
      _count: { select: { members: true } },
      coach: { include: { person: true } },
      facility: true,
      division: true,
      members: {
        include: { person: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { joinedAt: "asc" },
      },
    },
    orderBy: [{ market: "asc" }, { name: "asc" }],
  });

  // Diagnostics for "where did my teams go?" — the grid only shows the ONE active
  // PURE Academy season's non-test teams, so surface anything hidden by that.
  const activeId = stats.season?.id;
  const [activeSeasonCount, otherSeasonTeams, testTeams, hiddenTeamsWithMembers, assignedNoTeam] = await Promise.all([
    prisma.season.count({ where: { active: true, program: "PURE_ACADEMY" } }),
    activeId ? prisma.team.count({ where: { seasonId: { not: activeId }, isTest: false } }) : prisma.team.count(),
    activeId ? prisma.team.count({ where: { seasonId: activeId, isTest: true } }) : Promise.resolve(0),
    // The smoking gun: teams that HAVE players but are hidden (test-flagged or in
    // another season). These are the "assigned but missing from Teams" ones.
    prisma.team.findMany({
      where: {
        members: { some: {} },
        OR: [{ isTest: true }, ...(activeId ? [{ seasonId: { not: activeId } }] : [])],
      },
      select: { id: true, name: true, isTest: true, divisionCode: true, season: { select: { name: true, active: true } }, _count: { select: { members: true } } },
      orderBy: { name: "asc" },
      take: 50,
    }),
    // Registrations marked assigned but whose player is on no team in the active
    // season — their team was likely deleted (status left stale).
    activeId
      ? prisma.registration.count({
          where: { seasonId: activeId, status: "ASSIGNED", person: { teamMemberships: { none: { team: { seasonId: activeId } } } } },
        })
      : Promise.resolve(0),
  ]);

  const seasonRows = await prisma.season.findMany({
    orderBy: [{ active: "desc" }, { startDate: "desc" }],
    include: { divisions: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  const seasons = seasonRows.map((s) => ({ id: s.id, name: s.name, divisions: s.divisions }));
  const facilityRows = await prisma.facility.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    include: { courtBlocks: true },
  });
  const facilities = facilityRows.map((f) => ({ id: f.id, name: f.name }));

  // Availability windows per facility, so the bulk editor can constrain a team's
  // day/time to exactly the facility's open slots (falls back to free entry when
  // a facility has none defined).
  const slotsByFacility: Record<string, { day: string; start: string; end: string }[]> = {};
  for (const f of facilityRows) {
    const blocks = f.courtBlocks
      .map((b) => ({ day: b.dayOfWeek, start: b.startTime, end: b.endTime }))
      .sort(
        (a, b) =>
          (WEEKDAYS as readonly string[]).indexOf(a.day) - (WEEKDAYS as readonly string[]).indexOf(b.day) ||
          a.start.localeCompare(b.start),
      );
    if (blocks.length) slotsByFacility[f.id] = blocks;
  }

  // All summary numbers come from the counting service so the pills here match
  // the dashboard's "Teams complete" tile exactly.
  const ready = stats.teams.ready;
  const published = stats.teams.published;
  const readyToPublish = stats.teams.eligibleToPublish;

  // Checklist milestones read from the shared readiness sequence — the same
  // checkmarks the dashboard shows, so the two can't contradict.
  const doneOf = (key: string) => stats.readiness.find((s) => s.key === key)?.done ?? false;
  const steps = [
    { done: stats.teams.total > 0, label: "Create your first team", href: null, cta: "Create a team below" },
    { done: doneOf("teamsComplete"), label: "Complete each team (division, coach, facility, day/time)", href: null, cta: "" },
    { done: stats.teams.total > 0 && stats.teams.withoutPlayers === 0, label: "Add players to each team", href: "/console/board", cta: "Assignment board" },
    { done: doneOf("published"), label: "Publish ready teams to families", href: null, cta: "" },
  ];
  const nextStep = steps.find((s) => !s.done);

  // Color audit — group teams by gender+level (divisionCode, else division name)
  // and flag any group where two teams share a color or a team has none. Only
  // multi-team groups can collide, so single-team groups are never "issues".
  const colorGroups = new Map<string, { label: string; teams: { name: string; color: string | null }[] }>();
  for (const t of teams) {
    const key = t.divisionCode ?? deriveDivisionCode(t.division?.name) ?? t.division?.name ?? (t.divisionId ? `id:${t.divisionId}` : null);
    if (!key) continue;
    const label = t.divisionCode ?? deriveDivisionCode(t.division?.name) ?? t.division?.name ?? "Division";
    if (!colorGroups.has(key)) colorGroups.set(key, { label, teams: [] });
    colorGroups.get(key)!.teams.push({ name: t.name, color: t.color });
  }
  const colorAudit = [...colorGroups.values()]
    .filter((g) => g.teams.length > 1)
    .map((g) => {
      const named = g.teams.map((t) => (t.color ?? "").toLowerCase()).filter(Boolean);
      const hasDup = named.length !== new Set(named).size;
      const hasBlank = g.teams.some((t) => !t.color);
      return { ...g, ok: !hasDup && !hasBlank };
    })
    .sort((a, b) => Number(a.ok) - Number(b.ok) || a.label.localeCompare(b.label));
  const colorIssues = colorAudit.filter((g) => !g.ok).length;

  // Duplicate-team detector — two teams with the same name in this season almost
  // always means a duplicate record (the board then shows the same team twice).
  // Group by normalized name; flag any group with more than one team.
  const nameGroups = new Map<string, typeof teams>();
  for (const t of teams) {
    const key = t.name.trim().toLowerCase();
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key)!.push(t);
  }
  const duplicateGroups = [...nameGroups.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => a[0].name.localeCompare(b[0].name));

  // Drill-down facets: Segment (Men's / Women's / Youth), Level (the exact
  // division code, e.g. M3.5 or HS), and Location (market). They COMBINE, so you
  // can slice to "Women's · 3.5" or "Youth · High School · Mesa". Each narrows
  // the grid and the bulk tools; the season-wide audit cards hide while drilled.
  const codeOf = (t: (typeof teams)[number]) =>
    t.divisionCode ?? deriveDivisionCode(t.division?.name) ?? t.division?.name ?? null;
  const segOf = (code: string | null): "M" | "W" | "YOUTH" | null => {
    if (!code) return null;
    if (/^M/.test(code)) return "M";
    if (/^W/.test(code)) return "W";
    if (/^(ELE|MID|HS)$/.test(code)) return "YOUTH";
    return null;
  };
  const SEG_LABEL: Record<string, string> = { M: "Men's", W: "Women's", YOUTH: "Youth" };
  const LEVEL_LABEL: Record<string, string> = { ELE: "Elementary", MID: "Middle", HS: "High School" };
  const levelLabel = (code: string) => LEVEL_LABEL[code] ?? code;

  // Gender: use the team's stored gender when set; otherwise adults derive it
  // from the M/W division code. Youth teams have no gender in their code, so this
  // is the only way "High School Boys" vs "Girls" can be told apart.
  const GENDER_LABEL: Record<string, string> = { MALE: "Boys / Men", FEMALE: "Girls / Women", COED: "Coed" };
  const genderOf = (t: (typeof teams)[number]): "MALE" | "FEMALE" | "COED" | null => {
    if (t.gender === "MALE" || t.gender === "FEMALE" || t.gender === "COED") return t.gender;
    const seg = segOf(codeOf(t));
    return seg === "M" ? "MALE" : seg === "W" ? "FEMALE" : null;
  };

  const fSegment = sp.segment?.trim() || null;
  const fLevel = (sp.level ?? sp.division)?.trim() || null; // `division` kept as an alias
  const fMarket = sp.market?.trim() || null;
  const fGender = sp.gender?.trim() || null;
  const fLaunch = sp.launch?.trim() || null;
  const fSort = sp.sort?.trim() || "division";
  const anyFilter = !!(fSegment || fLevel || fMarket || fGender || fLaunch);

  // Launch lifecycle: launched (welcome+pay email sent) → ready to launch
  // (complete, nothing missing) → building (still missing required fields).
  const launchState = (t: (typeof teams)[number]): "launched" | "ready" | "building" =>
    t.launchedAt ? "launched" : teamMissingFields(t).length === 0 ? "ready" : "building";

  const shownTeams = teams.filter((t) => {
    const code = codeOf(t);
    if (fSegment && segOf(code) !== fSegment) return false;
    if (fLevel && code !== fLevel) return false;
    if (fMarket && (t.market ?? "") !== fMarket) return false;
    if (fGender && genderOf(t) !== fGender) return false;
    if (fLaunch && launchState(t) !== fLaunch) return false;
    return true;
  });

  // Options come from the teams that actually exist this season.
  const segmentsPresent = [...new Set(teams.map((t) => segOf(codeOf(t))).filter(Boolean))] as ("M" | "W" | "YOUTH")[];
  const levelsPresent = [...new Set(teams.map((t) => codeOf(t)).filter(Boolean))] as string[];
  const marketsPresent = [...new Set(teams.map((t) => t.market).filter(Boolean))] as string[];
  const gendersPresent = [...new Set(teams.map((t) => genderOf(t)).filter(Boolean))] as ("MALE" | "FEMALE" | "COED")[];
  gendersPresent.sort((a, b) => ({ MALE: 0, FEMALE: 1, COED: 2 }[a] - { MALE: 0, FEMALE: 1, COED: 2 }[b]));
  const orderSeg = { M: 0, W: 1, YOUTH: 2 } as Record<string, number>;
  segmentsPresent.sort((a, b) => (orderSeg[a] ?? 9) - (orderSeg[b] ?? 9));
  // Level chips respect a chosen segment (choosing Men's shows only M* levels).
  const levelChips = levelsPresent.filter((c) => !fSegment || segOf(c) === fSegment).sort();
  marketsPresent.sort();

  // Build a URL that keeps the other facets and toggles one. Passing null clears
  // a facet; clicking the already-active value clears it (a toggle).
  const facetHref = (over: { segment?: string | null; level?: string | null; market?: string | null; gender?: string | null; launch?: string | null; sort?: string | null }) => {
    const seg = "segment" in over ? over.segment : fSegment;
    const lvl = "level" in over ? over.level : fLevel;
    const mkt = "market" in over ? over.market : fMarket;
    const gen = "gender" in over ? over.gender : fGender;
    const lnc = "launch" in over ? over.launch : fLaunch;
    const srt = "sort" in over ? over.sort : fSort;
    const params = new URLSearchParams();
    if (seg) params.set("segment", seg);
    if (lvl) params.set("level", lvl);
    if (mkt) params.set("market", mkt);
    if (gen) params.set("gender", gen);
    if (lnc) params.set("launch", lnc);
    if (srt && srt !== "division") params.set("sort", srt); // division is the default
    const qs = params.toString();
    return `/console/teams${qs ? `?${qs}` : ""}#teams-grid`;
  };

  // Sort the shown teams by whatever field the admin picks — all backed by data
  // we actually store. Default groups by division (segment → level), matching how
  // people think about the roster.
  const bandOf = (code: string | null) => parseFloat(code?.match(/(\d\.\d)/)?.[1] ?? "0");
  const youthRank = (code: string | null) => (code === "ELE" ? 0 : code === "MID" ? 1 : code === "HS" ? 2 : 9);
  const segRank = (code: string | null) => (segOf(code) === "M" ? 0 : segOf(code) === "W" ? 1 : segOf(code) === "YOUTH" ? 2 : 3);
  const divKey = (t: (typeof teams)[number]): [number, number, string] => {
    const code = codeOf(t);
    const s = segRank(code);
    return [s, s === 2 ? youthRank(code) : bandOf(code), t.market ?? ""];
  };
  const statusRank = (t: (typeof teams)[number]) => (t.published ? 2 : teamMissingFields(t).length === 0 ? 1 : 0);
  const launchRank = (t: (typeof teams)[number]) => ({ launched: 0, ready: 1, building: 2 }[launchState(t)]);
  const dayRank = (d: string | null) => { const i = (WEEKDAYS as readonly string[]).indexOf(d ?? ""); return i < 0 ? 99 : i; };
  const cmpByName = (a: (typeof teams)[number], b: (typeof teams)[number]) => a.name.localeCompare(b.name);
  const SORTS: Record<string, { label: string; cmp: (a: (typeof teams)[number], b: (typeof teams)[number]) => number }> = {
    division: { label: "Division", cmp: (a, b) => { const ka = divKey(a), kb = divKey(b); return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]) || cmpByName(a, b); } },
    location: { label: "Location", cmp: (a, b) => (a.market ?? "").localeCompare(b.market ?? "") || cmpByName(a, b) },
    name: { label: "Name", cmp: cmpByName },
    players: { label: "Players", cmp: (a, b) => b._count.members - a._count.members || cmpByName(a, b) },
    status: { label: "Status", cmp: (a, b) => statusRank(a) - statusRank(b) || cmpByName(a, b) },
    launch: { label: "Launch status", cmp: (a, b) => launchRank(a) - launchRank(b) || cmpByName(a, b) },
    day: { label: "Day/time", cmp: (a, b) => dayRank(a.dayOfWeek) - dayRank(b.dayOfWeek) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || cmpByName(a, b) },
  };
  const shownSorted = [...shownTeams].sort((SORTS[fSort] ?? SORTS.division).cmp);

  return (
    <div className="space-y-6">
      <RosteringTabs active="teams" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Teams</h1>
          <p className="text-slate-500">
            Every team&apos;s six fields and completion status. Cap {TEAM_CAP} per team.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Pill label="Teams" value={teams.length} />
          <Pill label="Ready" value={ready} tone="emerald" />
          <Pill label="Published" value={published} tone="brand" />
        </div>
      </div>

      {sp.ok && OK[sp.ok] && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {OK[sp.ok]}
          {sp.ok === "schedule" && sp.skipped ? ` (${sp.skipped} skipped — day/time was outside the facility's available hours.)` : ""}
        </p>
      )}
      {sp.ok === "consolidated" && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Moved {sp.n ?? "0"} team{sp.n === "1" ? "" : "s"} into the active season. They should now show below and in the Move-to-team picker.
        </p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {ERRORS[sp.err] ?? "Something went wrong."}
        </p>
      )}

      {/* "Where did my teams go?" — this page only shows the ONE active PURE
          Academy season's non-test teams. If teams look missing, this explains
          exactly what's hidden and why. */}
      {(activeSeasonCount > 1 || otherSeasonTeams > 0 || testTeams > 0 || hiddenTeamsWithMembers.length > 0 || assignedNoTeam > 0) && (
        <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Not seeing all your teams? This grid — and the &ldquo;Move to team&rdquo; picker — show only the active season&apos;s teams.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Showing <strong>{teams.length}</strong> team{teams.length === 1 ? "" : "s"} in the active season{stats.season ? <> — <strong>{stats.season.name}</strong></> : ""}.</li>
            {activeSeasonCount > 1 && (
              <li className="text-rose-800">
                <strong>{activeSeasonCount} PURE Academy seasons are marked active.</strong> This page picks only one, so the others&apos; teams are hidden. Set the correct one as the only active season in <Link href="/console/setup" className="underline">Season setup</Link>.
              </li>
            )}
            {testTeams > 0 && (
              <li><strong>{testTeams}</strong> team{testTeams === 1 ? "" : "s"} in this season are flagged <em>test</em> and hidden.</li>
            )}
            {assignedNoTeam > 0 && (
              <li><strong>{assignedNoTeam}</strong> player{assignedNoTeam === 1 ? " is" : "s are"} marked &ldquo;assigned&rdquo; but not on any team in this season — their team may have been deleted or lives in another season.</li>
            )}
          </ul>
          {hiddenTeamsWithMembers.length > 0 && (
            <div className="mt-3">
              <p className="font-medium">Teams with players that are hidden from this season:</p>
              <ul className="mt-1 space-y-0.5">
                {hiddenTeamsWithMembers.map((t) => (
                  <li key={t.id} className="text-xs">
                    <strong>{t.name}</strong> ({t.divisionCode ?? "—"}, {t._count.members} player{t._count.members === 1 ? "" : "s"}) —{" "}
                    {t.isTest ? "flagged test" : <>in season <strong>{t.season?.name ?? "—"}</strong>{t.season?.active ? " (also active)" : ""}</>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-800">
                Fix: move these teams into the active registration season. This pulls every team that holds a current registrant into the one active season, so they reappear here and in the Move picker.
              </p>
              <div className="mt-2">
                <ConfirmSubmit
                  action="/api/console/teams"
                  fields={{ ticket, op: "consolidateSeason" }}
                  confirm="Move all teams that hold a current registrant into the active season? This fixes teams that were built in a different season than the registrations. Safe — it only moves PURE Academy teams that have a current-season player."
                  label="Move these teams into the active season"
                  className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Duplicate-team detector — same name = almost always a duplicate record,
          which shows twice on the board. Review each and delete the extra. */}
      {!anyFilter && duplicateGroups.length > 0 && (
        <div className="card border-l-4 border-rose-400">
          <h2 className="font-semibold text-rose-700">
            {duplicateGroups.length} duplicate team name{duplicateGroups.length === 1 ? "" : "s"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            These names each belong to more than one team, so the board shows them twice. Open each to compare rosters,
            then delete the extra — deleting returns its players to the assignment pool, so re-check the kept team&apos;s
            roster afterward.
          </p>
          <div className="mt-3 space-y-3">
            {duplicateGroups.map((group) => (
              <div key={group[0].name} className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
                <div className="text-sm font-semibold text-slate-800">{group[0].name} <span className="text-xs font-normal text-slate-400">· {group.length} teams</span></div>
                <div className="mt-2 space-y-1.5">
                  {group.map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-200">
                      <span className="flex items-center gap-1.5">
                        <TeamColorDot color={t.color} />
                        <span className="text-slate-700">{t.division?.name ?? "no division"}</span>
                        <span className="text-slate-400">· {t._count.members} player{t._count.members === 1 ? "" : "s"}{t.published ? " · published" : ""}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <Link href={`/console/teams/${t.id}`} className="text-xs font-medium text-brand-600 hover:underline">Manage</Link>
                        <ConfirmSubmit
                          action="/api/console/teams"
                          fields={{ ticket, op: "mergeTeams", keepId: t.id, removeIds: group.filter((o) => o.id !== t.id).map((o) => o.id).join(",") }}
                          confirm={`Keep this "${t.name}" and merge the other ${group.length - 1} duplicate(s) into it? Their players move onto this team and the duplicates are deleted. This can't be undone.`}
                          label="Keep & merge others"
                          className="text-xs font-medium text-emerald-700 hover:underline"
                        />
                        <ConfirmSubmit
                          action="/api/console/teams"
                          fields={{ ticket, op: "deleteTeam", teamId: t.id }}
                          confirm={`Delete this "${t.name}" team? Its ${t._count.members} player(s) return to the assignment pool. This can't be undone.`}
                          label="Delete"
                          className="text-xs font-medium text-rose-600 hover:underline"
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Guided next steps */}
      <div className="card border-l-4 border-brand-500">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-900">Team build checklist</h2>
            {nextStep ? (
              <p className="mt-0.5 text-sm text-slate-600">Next: <span className="font-medium text-slate-800">{nextStep.label}</span></p>
            ) : (
              <p className="mt-0.5 text-sm text-emerald-700">Every team is complete and published. 🎉</p>
            )}
          </div>
          {readyToPublish > 0 && (
            <span className="badge bg-emerald-100 text-emerald-800">{readyToPublish} ready to publish</span>
          )}
        </div>
        <ol className="mt-3 space-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${s.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{s.done ? "✓" : i + 1}</span>
              <span className={s.done ? "text-slate-500 line-through" : "text-slate-700"}>{s.label}</span>
              {!s.done && s.href && <Link href={s.href} className="text-xs text-brand-700 underline">{s.cta}</Link>}
            </li>
          ))}
        </ol>
      </div>

      <TeamCreateForm ticket={ticket} seasons={seasons} facilities={facilities} />

      {shownTeams.length > 0 && (
        <BulkScheduleEditor
          ticket={ticket}
          facilities={facilities}
          slotsByFacility={slotsByFacility}
          teams={shownTeams.map((t) => ({
            id: t.id,
            name: t.name,
            market: t.market,
            dayOfWeek: t.dayOfWeek,
            startTime: t.startTime,
            facilityId: t.facilityId,
          }))}
        />
      )}

      {!anyFilter && teams.length > 0 && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Team colors</h2>
              <p className="text-sm text-slate-500">
                Every team needs a distinct color within its gender+level group (e.g. one Women&apos;s 3.0 Red, one
                Blue). Assigns Red, Blue, Green, White, Black… in order per group and clears duplicates.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {colorIssues > 0 ? (
                <span className="badge bg-amber-100 text-amber-800">{colorIssues} group{colorIssues === 1 ? "" : "s"} to fix</span>
              ) : (
                <span className="badge bg-emerald-100 text-emerald-800">all distinct</span>
              )}
              <form method="POST" action="/api/console/teams">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="autoAssignColors" />
                <button className="btn-secondary text-sm">Auto-assign colors</button>
              </form>
            </div>
          </div>

          {colorAudit.length > 0 && (
            <div className="mt-3 space-y-2">
              {colorAudit.map((g) => (
                <div key={g.label} className={`rounded-lg border p-2.5 text-sm ${g.ok ? "border-slate-200" : "border-amber-300 bg-amber-50"}`}>
                  <div className="flex items-center gap-2">
                    <span className={g.ok ? "text-emerald-600" : "text-amber-600"}>{g.ok ? "✓" : "!"}</span>
                    <Link href={facetHref({ level: g.label, segment: segOf(g.label) })} className="font-medium text-brand-700 hover:underline">{g.label}</Link>
                    <span className="text-xs text-slate-400">{g.teams.length} teams</span>
                    <Link href={facetHref({ level: g.label, segment: segOf(g.label) })} className="ml-auto text-xs font-medium text-brand-600 hover:underline">Open →</Link>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {g.teams.map((t, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">
                        <span className="h-2.5 w-2.5 rounded-full ring-1 ring-slate-300" style={{ backgroundColor: cssColor(t.color) }} />
                        {t.color ?? "no color"} <span className="text-slate-400">· {t.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {teams.length === 0 ? (
        <div className="card">
          <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No teams yet. Create one above, then fill its roster by dragging players from the pools on the{" "}
            <Link href="/console/board" className="text-brand-700 underline">Assignment board</Link>.
          </p>
        </div>
      ) : (
        <>
        {/* Drill-down facet bar — Segment / Level / Location, all combinable. */}
        <div className="card space-y-2.5 py-3">
          <FacetRow label="Segment">
            <Chip href={facetHref({ segment: null, level: null })} active={!fSegment}>All</Chip>
            {segmentsPresent.map((s) => (
              <Chip key={s} href={facetHref({ segment: fSegment === s ? null : s, level: null })} active={fSegment === s}>{SEG_LABEL[s]}</Chip>
            ))}
          </FacetRow>
          {levelChips.length > 0 && (
            <FacetRow label="Level">
              <Chip href={facetHref({ level: null })} active={!fLevel}>All</Chip>
              {levelChips.map((c) => (
                <Chip key={c} href={facetHref({ level: fLevel === c ? null : c, segment: segOf(c) })} active={fLevel === c}>{levelLabel(c)}</Chip>
              ))}
            </FacetRow>
          )}
          {gendersPresent.length > 1 && (
            <FacetRow label="Gender">
              <Chip href={facetHref({ gender: null })} active={!fGender}>All</Chip>
              {gendersPresent.map((gn) => (
                <Chip key={gn} href={facetHref({ gender: fGender === gn ? null : gn })} active={fGender === gn}>{GENDER_LABEL[gn]}</Chip>
              ))}
            </FacetRow>
          )}
          {marketsPresent.length > 0 && (
            <FacetRow label="Location">
              <Chip href={facetHref({ market: null })} active={!fMarket}>All</Chip>
              {marketsPresent.map((m) => (
                <Chip key={m} href={facetHref({ market: fMarket === m ? null : m })} active={fMarket === m}>{m}</Chip>
              ))}
            </FacetRow>
          )}
          <FacetRow label="Launch">
            <Chip href={facetHref({ launch: null })} active={!fLaunch}>All</Chip>
            {([["launched", "Launched"], ["ready", "Ready to launch"], ["building", "Building"]] as const).map(([val, lbl]) => (
              <Chip key={val} href={facetHref({ launch: fLaunch === val ? null : val })} active={fLaunch === val}>
                {lbl} <span className="text-slate-400">({teams.filter((t) => launchState(t) === val).length})</span>
              </Chip>
            ))}
          </FacetRow>
          <FacetRow label="Sort by">
            {Object.entries(SORTS).map(([key, s]) => (
              <Chip key={key} href={facetHref({ sort: key })} active={fSort === key}>{s.label}</Chip>
            ))}
          </FacetRow>
          {anyFilter && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
              <span className="text-slate-500">{shownTeams.length} team{shownTeams.length === 1 ? "" : "s"} match</span>
              <Link href="/console/teams" className="font-medium text-brand-700 hover:underline">Clear filters</Link>
            </div>
          )}
        </div>
        <div className="max-w-md">
          <TableFilter targetId="teams-grid" placeholder="Search teams by name, market, or division…" />
        </div>
        {anyFilter && shownTeams.length === 0 ? (
          <div className="card py-8 text-center text-sm text-slate-400">No teams match those filters. <Link href="/console/teams" className="text-brand-700 underline">Clear filters</Link>.</div>
        ) : null}
        <div id="teams-grid" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shownSorted.map((t) => {
            const missing = teamMissingFields(t);
            const roster = rosterStatus(t._count.members, t.coachPlays);
            const publish = canPublishTeam(t, t.facility);
            return (
              <div key={t.id} data-filter-row data-filter-text={`${t.name} ${t.market ?? ""} ${t.divisionCode ?? ""} ${t.division?.name ?? ""} ${t.members.map((m) => `${m.person.firstName} ${m.person.lastName}`).join(" ")}`} className="card transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/console/teams/${t.id}`} className="inline-flex items-center gap-1.5 font-semibold text-slate-900 hover:text-brand-700">
                      <TeamColorDot color={t.color} />
                      {t.name}
                    </Link>
                    <p className="text-xs text-slate-400">
                      {t.origin === "ACP_CLUB" ? t.clubName ?? "Outside club" : "PURE Academy"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {t.launchedAt ? (
                      <span className="badge whitespace-nowrap bg-emerald-100 text-emerald-800">✓ Launched</span>
                    ) : missing.length === 0 ? (
                      <span className="badge whitespace-nowrap bg-indigo-100 text-indigo-800">Ready to launch</span>
                    ) : (
                      <span className="badge whitespace-nowrap bg-amber-100 text-amber-800">Building</span>
                    )}
                    {t.published && <StatusBadge status="PUBLISHED" />}
                  </div>
                </div>

                {/* Six fields */}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <Field label="Division" value={t.division?.name} />
                  <Field label="Level band" value={t.levelBand} />
                  <Field label="Market" value={t.market} />
                  <Field label="Coach" value={t.coach ? `${t.coach.person.firstName} ${t.coach.person.lastName}` : t.origin === "ACP_CLUB" ? "n/a (contact)" : null} />
                  <Field label="Facility" value={t.facility?.name} />
                  <Field label="Day / time" value={t.dayOfWeek ? `${t.dayOfWeek} ${formatTime12(t.startTime)}`.trim() : null} />
                </dl>

                {/* Roster meter */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Roster {roster.effective}/{TEAM_CAP}{t.coachPlays ? " (coach plays)" : ""}</span>
                    <span>{roster.effective === 0 ? "no players yet" : ""}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full ${roster.effective > 0 ? "bg-emerald-500" : "bg-slate-300"}`}
                      style={{ width: `${Math.min(100, (roster.effective / TEAM_CAP) * 100)}%` }}
                    />
                  </div>
                  {/* The players themselves, right on the card — no need to open
                      the team to see who's on it. */}
                  {t.members.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {t.members.map((m) => (
                        <li key={m.personId} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          <Link href={`/console/people/${m.person.id}`} className="hover:text-brand-700 hover:underline">
                            {m.person.firstName} {m.person.lastName}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">No players yet.</p>
                  )}
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

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                  {publish.ok && !t.published ? (
                    <ConfirmSubmit
                      action="/api/console/teams"
                      fields={{ ticket, op: "publishTeam", teamId: t.id }}
                      confirm={`Publish "${t.name}" to families? It becomes visible to players and parents.`}
                      label="Publish to families"
                      className="btn-primary py-1 text-xs"
                    />
                  ) : (
                    <span />
                  )}
                  <Link href={`/console/teams/${t.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                    Manage team →
                  </Link>
                </div>
              </div>
            );
          })}
          <div data-filter-empty hidden className="card py-8 text-center text-sm text-slate-400 md:col-span-2 xl:col-span-3">No teams match your search.</div>
        </div>
        </>
      )}
    </div>
  );
}

function cssColor(name: string | null): string {
  const map: Record<string, string> = {
    red: "#ef4444", blue: "#3b82f6", green: "#22c55e", white: "#f8fafc",
    black: "#1e293b", yellow: "#eab308", orange: "#f97316", purple: "#a855f7",
  };
  return map[(name ?? "").toLowerCase()] ?? "#e2e8f0";
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

function FacetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-sm ring-1 ring-inset transition-colors ${
        active
          ? "bg-brand-600 text-white ring-brand-600"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300"
      }`}
    >
      {children}
    </Link>
  );
}
