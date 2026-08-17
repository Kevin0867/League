import Link from "next/link";
import { formatStamp } from "@/lib/time";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { rosterStatus, canPublishTeam, teamMissingFields, coachAssignmentGate } from "@/lib/domain/teams";
import { TEAM_CAP, WEEKDAYS } from "@/lib/enums";
import { TEAM_COLOR_PALETTE } from "@/lib/domain/teamName";
import { garmentLabel, sizeLabel } from "@/lib/domain/apparel";
import { TeamColorDot } from "@/components/TeamColorDot";
import { TeamScheduleFields } from "./TeamScheduleFields";
import { mintConsoleTicket } from "@/lib/auth";
import { DeleteTeamButton } from "@/components/DeleteTeamButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { AddPlayerToTeam } from "./AddPlayerToTeam";
import { PrintButton } from "@/components/PrintButton";
import { TeamPhotoUploadForm } from "@/components/TeamPhotoUploadForm";

export const dynamic = "force-dynamic";

// Any email on file counts — the player's own (email/email2/email3, where a
// minor's parent email is stored) or the guardian record's. Only flag "no email"
// when the family has none anywhere.
type WithEmails = { email?: string | null; email2?: string | null; email3?: string | null };
function anyEmail(p: WithEmails | null | undefined): boolean {
  return !!(p && (p.email || p.email2 || p.email3));
}
function hasFamilyEmail(person: WithEmails & { guardian?: WithEmails | null }): boolean {
  return anyEmail(person) || anyEmail(person.guardian);
}

const OK_MSG: Record<string, string> = {
  updateTeam: "Team fields saved.",
  addPlayer: "Player added to the roster.",
  removePlayer: "Player removed back to the pool.",
  publishTeam: "Team published to families.",
  unpublishTeam: "Team unpublished.",
  requestSeasonFees: "Season fee + apparel requests sent. Players pick their apparel on the pay page.",
  launched: "Team launched — one combined email (welcome + apparel & fee + waiver) sent to each family.",
  welcome: "Welcome / placement email sent to the team.",
  waivers: "Waiver requests sent to players who hadn't signed.",
  resentAll: "Fee reminders resent to unpaid players.",
  addTeamCoach: "Coach added to the team.",
  removeTeamCoach: "Coach removed from the team.",
};

const ERR_MSG: Record<string, string> = {
  auth: "Not authorized to manage teams.",
  team: "Missing team.",
  coach: "Cannot assign this coach — not cleared (background check required).",
  coachgate: "Cannot add this coach — not cleared (background check required).",
  coachishead: "That coach is already the head coach of this team.",
  coachclash: "That coach already coaches another team at this day/time. Pick a non-overlapping slot or use “add anyway.”",
  colorclash: "Another team in this division already uses that color. Every team in a division needs a distinct color.",
  slot: "That day/time isn't available at the selected facility. Pick one of the facility's available times.",
  dupname: "A team with that name already exists this season — here it is. Give the new team a distinct name (e.g. a different color).",
  player: "Missing player.",
  cap: "That team is already at capacity — remove a player before adding another.",
  notfound: "Team not found.",
  publish: "Team cannot be published yet.",
  op: "Unknown action.",
};

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const { ok, err, imgok, imgerr, n, failed, failedNames } = await searchParams;
  const ticket = await mintConsoleTicket();
  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      facility: true,
      division: true,
      coach: { include: { person: true } },
      assistantCoaches: { include: { coach: { include: { person: true } } } },
      members: { include: { person: { include: { guardian: true } } }, orderBy: { joinedAt: "asc" } },
      season: { include: { divisions: { orderBy: { name: "asc" } } } },
    },
  });
  if (!team) notFound();

  const [coaches, facilities, candidateRegs] = await Promise.all([
    prisma.coach.findMany({ include: { person: true }, orderBy: { person: { lastName: "asc" } } }),
    prisma.facility.findMany({ where: { archived: false }, orderBy: { name: "asc" }, include: { courtBlocks: true } }),
    // Registered players this season who aren't already on this team — the pool
    // of people the roster's "Add players" picker can pull from.
    prisma.registration.findMany({
      where: {
        seasonId: team.seasonId,
        status: { notIn: ["WITHDRAWN", "DUPLICATE", "MERGED"] },
        person: { teamMemberships: { none: { teamId: team.id } } },
      },
      include: { person: { select: { id: true, firstName: true, lastName: true } }, division: { select: { name: true } } },
      orderBy: [{ person: { lastName: "asc" } }],
    }),
  ]);

  // De-dupe by person (a person can have >1 registration) and describe each.
  const seenCandidate = new Set<string>();
  const candidates = candidateRegs
    .filter((r) => (seenCandidate.has(r.person.id) ? false : (seenCandidate.add(r.person.id), true)))
    .map((r) => ({
      id: r.person.id,
      name: `${r.person.firstName} ${r.person.lastName}`,
      meta: [r.division?.name, r.status === "ASSIGNED" ? "on another team" : r.status.toLowerCase()].filter(Boolean).join(" · "),
    }));

  // Facility availability windows, keyed by facility, for the schedule picker.
  const slotsByFacility: Record<string, { day: string; start: string; end: string }[]> = {};
  for (const f of facilities) {
    const blocks = [...f.courtBlocks]
      .map((b) => ({ day: b.dayOfWeek, start: b.startTime, end: b.endTime }))
      .sort((a, b) => (WEEKDAYS as readonly string[]).indexOf(a.day) - (WEEKDAYS as readonly string[]).indexOf(b.day) || a.start.localeCompare(b.start));
    if (blocks.length) slotsByFacility[f.id] = blocks;
  }

  const roster = rosterStatus(team.members.length, team.coachPlays);
  const publish = canPublishTeam(team, team.facility, team.members.length);
  const missing = teamMissingFields(team);

  // How many rostered players still need a season-fee request?
  const memberIds = team.members.map((m) => m.personId);
  // Each member's registration this season, so their name links straight to the
  // editable profile (add email/phone, resend, assign) — the same detail page
  // people open from Registrations. Falls back to the person profile.
  const memberRegs = memberIds.length
    ? await prisma.registration.findMany({
        where: { seasonId: team.seasonId, personId: { in: memberIds } },
        select: { id: true, personId: true },
      })
    : [];
  const regByPerson = new Map(memberRegs.map((r) => [r.personId, r.id]));
  const profileHref = (personId: string) =>
    regByPerson.has(personId) ? `/console/registrations/${regByPerson.get(personId)}` : `/console/people/${personId}`;
  const existingFees = memberIds.length
    ? await prisma.payment.findMany({
        where: { partyId: { in: memberIds }, seasonId: team.seasonId, category: "PLAYER_FEE" },
        select: { partyId: true },
      })
    : [];
  const paidOrRequested = new Set(existingFees.map((p) => p.partyId));
  const feesToRequest = memberIds.filter((id) => !paidOrRequested.has(id)).length;

  // Season-fee payments for this team's players — used to offer a "preview / test
  // the pay page" link (admins can walk the apparel + checkout flow, no charge).
  const feePayments = memberIds.length
    ? await prisma.payment.findMany({
        where: { partyId: { in: memberIds }, seasonId: team.seasonId, category: "PLAYER_FEE" },
        select: { id: true, partyId: true, status: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // Colors used by OTHER teams in this team's gender+level group (divisionCode) —
  // shown as taken in the picker so every team in a division stays a distinct color.
  const usedColors = team.divisionCode
    ? ((await prisma.team.findMany({ where: { divisionCode: team.divisionCode, id: { not: team.id } }, select: { color: true } }))
        .map((t) => t.color)
        .filter(Boolean) as string[])
    : [];
  const usedColorSet = new Set(usedColors.map((c) => c.toLowerCase()));

  // Launch readiness + how many players still need a waiver (coach-players skip).
  const waiversNeeded = team.members.filter((m) => m.roleOnTeam !== "COACH_PLAYER" && !m.person.waiverSignedAt).length;
  const hasCoach = !!team.coachId;
  const hasFacility = !!team.facilityId;
  const hasDayTime = !!(team.dayOfWeek && team.startTime);
  const readyToLaunch = hasCoach && hasFacility && hasDayTime && team.members.length > 0;

  // Launch is never blocked — but the admin gets a heads-up listing anything
  // unusual (no/uncleared coach, unexecuted facility, missing day/time) so the
  // decision is informed. The confirm dialog repeats these before sending.
  const launchWarnings: string[] = [];
  if (!hasCoach) launchWarnings.push("no coach is assigned");
  else if (team.coach && !coachAssignmentGate(team.coach).ok) {
    launchWarnings.push(`${team.coach.person.firstName} ${team.coach.person.lastName} has no background check on file`);
  }
  if (!hasFacility) launchWarnings.push("no facility is set");
  else if (team.facility && team.facility.agreementStatus !== "EXECUTED") launchWarnings.push("the facility agreement isn't executed");
  if (!hasDayTime) launchWarnings.push("no practice day/time is set");
  const launchWarnText = launchWarnings.length
    ? `Heads up — ${launchWarnings.join("; ")}. `
    : "";

  // Team apparel orders (what to print, and the size tally for bulk ordering).
  const apparelItems = memberIds.length
    ? await prisma.apparelOrderItem.findMany({
        where: { personId: { in: memberIds } },
        include: { payment: { select: { status: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const nameById = new Map(team.members.map((m) => [m.personId, `${m.person.firstName} ${m.person.lastName}`]));
  // Size tally per garment for the printer, e.g. { SHIRT: { AM: 3, AL: 2 } }.
  const tally: Record<string, Record<string, number>> = {};
  for (const it of apparelItems) {
    (tally[it.garment] ??= {})[it.size] = (tally[it.garment]?.[it.size] ?? 0) + it.quantity;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/console/teams" className="text-sm text-brand-600 hover:underline">← All teams</Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900">
            <TeamColorDot color={team.color} size={16} />
            {team.name}
            {team.color && <span className="text-sm font-medium text-slate-400">{team.color}</span>}
          </h1>
          <p className="text-sm text-slate-500">
            {team.origin === "ACP_CLUB" ? team.clubName ?? "Outside club" : "PURE Academy"} · {team.season.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {team.isTest && <span className="badge bg-amber-100 text-amber-800">Test</span>}
          <PrintButton label="Print roster" />
          {team.published ? <StatusBadge status="PUBLISHED" /> : missing.length === 0 ? <StatusBadge status="READY" /> : <StatusBadge status="BUILDING" />}
          <form method="POST" action="/api/console/teams">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="toggleTeamTest" />
            <input type="hidden" name="teamId" value={team.id} />
            <button className="text-xs font-medium text-slate-400 hover:underline">{team.isTest ? "Unmark test" : "Mark test"}</button>
          </form>
        </div>
      </div>

      {ok && Number(failed) > 0 ? (
        <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {ok === "launched"
            ? `Launched to ${n ?? 0} famil${n === "1" ? "y" : "ies"} — but `
            : `${OK_MSG[ok] ?? "Done"} — but `}
          <strong>{failed} had no email on file, so nothing was delivered to them</strong>
          {failedNames ? `: ${failedNames}` : ""}. Add an email to those players (or their parent) in Registrations, then resend.
        </div>
      ) : ok === "launched" ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          Launched — combined welcome + apparel &amp; fee + waiver emailed/texted to {n ?? 0} famil{n === "1" ? "y" : "ies"}.
        </div>
      ) : ok && OK_MSG[ok] ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{OK_MSG[ok]}</div>
      ) : null}
      {imgok === "team" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Team photo uploaded.</div>
      )}
      {err && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{ERR_MSG[err] ?? "Something went wrong."}</div>
      )}
      {imgerr && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{imgerr === "auth" ? "Not authorized to change this team's photo." : imgerr}</div>
      )}

      {/* LAUNCH — the deliberate go-live. Assigning players messages no one;
          families hear from us only when an admin sends from here. */}
      <div className="card border-l-4 border-brand-500">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Launch this team</h2>
          {readyToLaunch ? (
            <span className="badge bg-emerald-100 text-emerald-800">ready to launch</span>
          ) : (
            <span className="badge bg-amber-100 text-amber-800">finish setup first</span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Assigning players never messages anyone. When the team is set, launch it — <strong>one combined email per player</strong>{" "}
          (to their family) with the welcome, apparel + that player&apos;s season-fee payment, and the waiver, all together. You control who and when.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <ReadyChip ok={hasCoach} label="Coach" />
          <ReadyChip ok={hasFacility} label="Facility" />
          <ReadyChip ok={hasDayTime} label="Day / time" />
          <ReadyChip ok={team.members.length > 0} label={`Roster ${roster.effective}`} />
        </div>

        {/* One-click launch — the combined email. */}
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">Launch team — send everything</div>
              <p className="mt-0.5 text-xs text-slate-500">One combined email per player (to their family): welcome + pick apparel &amp; pay their season fee + complete the waiver.</p>
            </div>
            {team.members.length === 0 ? (
              <span className="text-xs text-slate-400">Add players first.</span>
            ) : (
              <ConfirmSubmit
                action="/api/console/teams"
                fields={{ ticket, op: "launchTeam", teamId: team.id }}
                confirm={`${launchWarnText}Launch "${team.name}"? Sends one combined email (welcome + apparel & fee + waiver) to every player's family.`}
                confirmLabel={launchWarnings.length ? "Launch anyway" : "Launch team"}
                danger={launchWarnings.length > 0}
                label="Launch team"
                className="btn-primary text-sm"
              />
            )}
          </div>
        </div>

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Or send individually (backup)</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-800">1 · Welcome</div>
            <p className="mb-2 mt-0.5 text-xs text-slate-500">Placement email: team, coach, location, day &amp; time.</p>
            <div className="mt-auto">
              {team.members.length === 0 ? (
                <span className="text-xs text-slate-400">No players yet.</span>
              ) : (
                <ConfirmSubmit
                  action="/api/console/teams"
                  fields={{ ticket, op: "sendTeamWelcome", teamId: team.id }}
                  confirm={`Send the welcome / placement email to all ${team.members.length} player${team.members.length > 1 ? "s" : ""} on "${team.name}"?`}
                  label="Send welcome"
                  className="btn-secondary w-full text-sm"
                />
              )}
            </div>
          </div>
          <div className="flex flex-col rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-800">2 · Season fee + apparel</div>
            <p className="mb-2 mt-0.5 text-xs text-slate-500">{feesToRequest === 0 ? "✓ All players billed." : `${feesToRequest} not yet billed.`}</p>
            <div className="mt-auto">
              {team.members.length === 0 ? (
                <span className="text-xs text-slate-400">No players yet.</span>
              ) : feesToRequest > 0 ? (
                <ConfirmSubmit
                  action="/api/console/teams"
                  fields={{ ticket, op: "requestSeasonFees", teamId: team.id }}
                  confirm={`Email the season fee + apparel request to ${feesToRequest} player${feesToRequest > 1 ? "s" : ""}? They'll pick their apparel on the pay page.`}
                  label={`Request fee + apparel (${feesToRequest})`}
                  className="btn-secondary w-full text-sm"
                />
              ) : (
                <ConfirmSubmit
                  action="/api/console/registrations"
                  fields={{ ticket, op: "resendAllFees", teamId: team.id }}
                  confirm={`Resend the season fee + apparel request to everyone on "${team.name}" who hasn't paid?`}
                  label="Resend fee + apparel"
                  className="btn-secondary w-full text-sm"
                />
              )}
            </div>
          </div>
          <div className="flex flex-col rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-medium text-slate-800">3 · Waiver</div>
            <p className="mb-2 mt-0.5 text-xs text-slate-500">{waiversNeeded === 0 ? "✓ All players signed." : `${waiversNeeded} not signed.`}</p>
            <div className="mt-auto">
              {team.members.length === 0 ? (
                <span className="text-xs text-slate-400">No players yet.</span>
              ) : waiversNeeded > 0 ? (
                <ConfirmSubmit
                  action="/api/console/teams"
                  fields={{ ticket, op: "sendTeamWaivers", teamId: team.id }}
                  confirm={`Send a waiver request to ${waiversNeeded} player${waiversNeeded > 1 ? "s" : ""} who haven't signed yet?`}
                  label={`Send waiver (${waiversNeeded})`}
                  className="btn-secondary w-full text-sm"
                />
              ) : (
                <ConfirmSubmit
                  action="/api/console/teams"
                  fields={{ ticket, op: "sendTeamWaivers", teamId: team.id, all: "1" }}
                  confirm={`Resend the waiver to everyone on "${team.name}"?`}
                  label="Resend waiver"
                  className="btn-secondary w-full text-sm"
                />
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">Publishing the team to families is in the Publication panel below.</p>
      </div>

      {/* Team apparel — what each player ordered + a size tally for the printer. */}
      <div className="card">
        <h2 className="font-semibold text-slate-900">Team apparel</h2>
        {apparelItems.length === 0 ? (
          <p className="mt-1 text-sm text-slate-400">No apparel orders yet — they come in with each player&apos;s season-fee payment.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {/* Size tally for bulk ordering */}
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Order tally</div>
              <div className="mt-1 space-y-0.5 text-sm text-slate-700">
                {Object.entries(tally).map(([g, sizes]) => (
                  <div key={g}>
                    <span className="font-medium">{garmentLabel(g)}:</span>{" "}
                    {Object.entries(sizes).map(([s, n], i) => (
                      <span key={s}>{i > 0 ? ", " : ""}{sizeLabel(s)} ×{n}</span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {/* Per-player breakdown */}
            <ul className="divide-y divide-slate-100 text-sm">
              {apparelItems.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-slate-700">
                    <span className="font-medium text-slate-800">{nameById.get(it.personId ?? "") ?? "—"}</span>
                    <span className="text-slate-400"> · </span>
                    {it.quantity} × {garmentLabel(it.garment)} {sizeLabel(it.size)}
                  </span>
                  {it.payment.status !== "PAID" && (
                    <span className="badge bg-amber-100 text-amber-800">{it.payment.status === "PENDING" ? "pending" : "unpaid"}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-400">Full order export: Reports → Apparel orders.</p>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold text-slate-900">Team photo</h2>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">
          Shown on the public team page — but only once every rostered player has media consent (a signed waiver with
          media consent). Where any player is missing consent, it&apos;s withheld rather than cropping anyone out.
        </p>
        <TeamPhotoUploadForm ticket={ticket} teamId={team.id} currentUrl={team.photoUrl} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Roster */}
        <div className="lg:col-span-1 space-y-4">
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Roster</h2>
              <span className="text-sm text-slate-500">{roster.effective}/{TEAM_CAP}{team.coachPlays ? " (coach plays)" : ""}</span>
            </div>
            {team.members.length > 0 && (
              <Link href={`/console/teams/${team.id}/progress`} className="mb-3 inline-flex items-center gap-1 rounded-md bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100 hover:bg-brand-100">
                Progress reports →
              </Link>
            )}
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${team.members.length > 0 ? "bg-emerald-500" : "bg-slate-300"}`}
                style={{ width: `${Math.min(100, (roster.effective / TEAM_CAP) * 100)}%` }} />
            </div>
            {team.members.length === 0 ? (
              <p className="text-sm text-slate-400">
                No players yet. Assign from the{" "}
                <Link href="/console/pools" className="text-brand-600 hover:underline">pool board</Link>.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {team.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2">
                    <div>
                      <Link href={profileHref(m.personId)} className="text-sm font-medium text-slate-800 hover:text-brand-700 hover:underline">
                        {m.person.firstName} {m.person.lastName}
                      </Link>
                      <div className="text-xs text-slate-400">
                        {m.person.duprRating ? `DUPR ${m.person.duprRating}` : "no rating"}
                        {!hasFamilyEmail(m.person) && <span className="ml-2 text-amber-600">⚠ no email</span>}
                        {!m.person.waiverSignedAt && <span className="ml-2 text-amber-600">⚠ no waiver</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link href={`/console/teams/${team.id}/progress/${m.personId}`} className="text-xs font-semibold text-brand-600 hover:underline">
                        notes
                      </Link>
                      <ConfirmSubmit
                        action="/api/console/teams"
                        fields={{ ticket, op: "removePlayer", teamId: team.id, personId: m.personId }}
                        confirm={`Remove ${m.person.firstName} ${m.person.lastName} from this team? They go back to the pool (no email is sent to the family).`}
                        label="remove"
                        className="text-xs text-rose-600 hover:underline"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <AddPlayerToTeam ticket={ticket} teamId={team.id} candidates={candidates} atCap={roster.atCap} />
          </div>

          {/* Publish gate */}
          <div className="card">
            <h2 className="mb-2 font-semibold text-slate-900">Publication</h2>
            {team.published ? (
              <>
                <p className="text-sm text-emerald-700">Published to families{team.publishedAt ? ` on ${formatStamp(team.publishedAt)}` : ""}.</p>
                <form method="POST" action="/api/console/teams" className="mt-3">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="unpublishTeam" />
                  <input type="hidden" name="teamId" value={team.id} />
                  <button className="btn-ghost text-sm">Unpublish</button>
                </form>
              </>
            ) : (
              <div>
                {publish.ok ? (
                  <p className="mb-3 text-sm text-slate-600">Ready to publish. Families will see the team, coach, location, day, and time.</p>
                ) : (
                  <p className="mb-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Heads up — {publish.reason} You can publish anyway.
                  </p>
                )}
                <ConfirmSubmit
                  action="/api/console/teams"
                  fields={{ ticket, op: "publishTeam", teamId: team.id }}
                  confirm={
                    publish.ok
                      ? `Publish "${team.name}" to families? It becomes visible to players and parents.`
                      : `Heads up — ${publish.reason} Publish "${team.name}" to families anyway?`
                  }
                  confirmLabel="Publish anyway"
                  danger={!publish.ok}
                  label="Publish to families"
                  className="btn-primary text-sm"
                />
              </div>
            )}
          </div>

          {/* Payment utilities only — the SEND actions (welcome, season fee +
              apparel, waiver, and Send all) live in the unified panel at the top
              of the page, matching the registration layout. This keeps just the
              admin extras: a blanket unpaid-reminder resend and no-charge pay-page
              previews. */}
          {team.members.length > 0 && (
            <div className="card">
              <h2 className="mb-2 font-semibold text-slate-900">Payments — reminders &amp; previews</h2>
              <p className="mb-2 text-xs text-slate-400">Send fee, waiver, and welcome from the panel at the top of this page.</p>
              <form method="POST" action="/api/console/registrations">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="resendAllFees" />
                <input type="hidden" name="teamId" value={team.id} />
                <button className="text-sm font-semibold text-brand-700 hover:underline">Resend reminders to unpaid players</button>
              </form>
              {feePayments.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Preview / test pay page</p>
                  <ul className="space-y-1">
                    {feePayments.map((fp) => (
                      <li key={fp.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-slate-600">{nameById.get(fp.partyId ?? "") ?? "Player"}{fp.status === "PAID" ? <span className="ml-1 text-xs text-emerald-600">paid</span> : null}</span>
                        <a href={`/pay/${fp.id}?test=1`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-700 hover:underline">Open pay page ↗</a>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-slate-400">Opens as admin test mode — no real charge.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Six fields editor */}
        <div className="lg:col-span-2">
          <form method="POST" action="/api/console/teams" className="card space-y-4">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="updateTeam" />
            <input type="hidden" name="teamId" value={team.id} />
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Team fields</h2>
              {missing.length > 0 && <span className="text-xs text-amber-600">Missing: {missing.join(", ")}</span>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Team name" name="name" defaultValue={team.name} />
              <Select label="Division" name="divisionId" defaultValue={team.divisionId ?? ""}
                options={[{ value: "", label: "—" }, ...team.season.divisions.map((d) => ({ value: d.id, label: d.name }))]} />
              <Field label="Level band" name="levelBand" defaultValue={team.levelBand ?? ""} placeholder="e.g. 4.0–4.5" />
              <Field label="Market" name="market" defaultValue={team.market ?? ""} />

              <div>
                <label className="label" htmlFor="color">Team color</label>
                <select id="color" name="color" defaultValue={team.color ?? ""} className="input">
                  <option value="">— none —</option>
                  {TEAM_COLOR_PALETTE.map((c) => {
                    const taken = usedColorSet.has(c.toLowerCase()) && c.toLowerCase() !== (team.color ?? "").toLowerCase();
                    return (
                      <option key={c} value={c} disabled={taken}>
                        {c}{taken ? " — taken in division" : ""}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1 text-xs text-slate-400">Every team in a gender+level group{team.divisionCode ? ` (${team.divisionCode})` : ""} needs a distinct color.</p>
              </div>

              <div>
                <label className="label" htmlFor="coachId">Coach {team.origin === "ACP_CLUB" && <span className="text-xs text-slate-400">(optional for outside teams)</span>}</label>
                <select id="coachId" name="coachId" defaultValue={team.coachId ?? ""} className="input">
                  <option value="">—</option>
                  {coaches.map((c) => {
                    const gate = coachAssignmentGate(c);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.person.firstName} {c.person.lastName}{!gate.ok ? " (not cleared)" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              <TeamScheduleFields
                facilities={facilities.map((f) => ({ id: f.id, name: f.name }))}
                slotsByFacility={slotsByFacility}
                initialFacilityId={team.facilityId ?? ""}
                initialDay={team.dayOfWeek ?? ""}
                initialStart={team.startTime ?? ""}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="coachPlays" defaultChecked={team.coachPlays} />
              Coach plays on this team (fills a roster slot; no second coach assigned)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              <input type="checkbox" name="force" value="1" />
              Allow this coach to overlap another team&apos;s day/time
            </label>

            <div className="flex justify-end">
              <button className="btn-primary">Save team</button>
            </div>
          </form>

          {/* Coaching staff — head coach + additional/assistant coaches. */}
          <div className="card mt-4 space-y-3">
            <div>
              <h2 className="font-semibold text-slate-900">Coaching staff</h2>
              <p className="text-sm text-slate-500">
                The head coach is set above. Add a 2nd/3rd or assistant coach here — a coach may hold multiple teams
                as long as the day/times don&apos;t overlap.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-100">
                <span className="text-slate-700">
                  {team.coach ? `${team.coach.person.firstName} ${team.coach.person.lastName}` : "No head coach set"}
                </span>
                <span className="badge bg-brand-100 text-brand-800">Head</span>
              </div>
              {team.assistantCoaches.map((tc) => (
                <div key={tc.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm ring-1 ring-slate-100">
                  <span className="text-slate-700">{tc.coach.person.firstName} {tc.coach.person.lastName}</span>
                  <span className="flex items-center gap-2">
                    <span className="badge bg-slate-100 text-slate-600 capitalize">{tc.role.toLowerCase()}</span>
                    <form method="POST" action="/api/console/teams">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="removeTeamCoach" />
                      <input type="hidden" name="teamId" value={team.id} />
                      <input type="hidden" name="coachId" value={tc.coachId} />
                      <button className="text-xs text-rose-600 hover:underline">Remove</button>
                    </form>
                  </span>
                </div>
              ))}
            </div>

            <form method="POST" action="/api/console/teams" className="grid gap-2 sm:grid-cols-6 sm:items-end">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="addTeamCoach" />
              <input type="hidden" name="teamId" value={team.id} />
              <div className="sm:col-span-3">
                <label className="label">Add coach</label>
                <select name="coachId" className="input" required>
                  <option value="">—</option>
                  {coaches
                    .filter((c) => c.id !== team.coachId && !team.assistantCoaches.some((tc) => tc.coachId === c.id))
                    .map((c) => {
                      const gate = coachAssignmentGate(c);
                      return (
                        <option key={c.id} value={c.id}>
                          {c.person.firstName} {c.person.lastName}{!gate.ok ? " (not cleared)" : ""}
                        </option>
                      );
                    })}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Role</label>
                <select name="role" className="input">
                  <option value="ASSISTANT">Assistant</option>
                  <option value="ADDITIONAL">Additional coach</option>
                </select>
              </div>
              <div className="sm:col-span-1">
                <button className="btn-secondary w-full">Add</button>
              </div>
              <label className="sm:col-span-6 flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" name="force" value="1" />
                Add even if it overlaps another team&apos;s day/time
              </label>
            </form>
          </div>

          {/* Danger zone */}
          <div className="mt-4 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50/50 px-5 py-4">
            <div>
              <div className="text-sm font-semibold text-slate-800">Delete this team</div>
              <div className="text-xs text-slate-500">Players return to the pool; fixtures for this team are removed.</div>
            </div>
            <DeleteTeamButton teamId={team.id} ticket={ticket} teamName={team.name} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadyChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${ok ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
      <span>{ok ? "✓" : "○"}</span>
      {label}
    </span>
  );
}

function Field({ label, name, defaultValue, placeholder, type = "text" }: { label: string; name: string; defaultValue?: string; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} className="input" />
    </div>
  );
}

function Select({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue} className="input">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
