import Link from "next/link";
import { formatStamp } from "@/lib/time";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { rosterStatus, canPublishTeam, teamMissingFields, coachAssignmentGate } from "@/lib/domain/teams";
import { TEAM_CAP, WEEKDAYS } from "@/lib/enums";
import { mintConsoleTicket } from "@/lib/auth";
import { DeleteTeamButton } from "@/components/DeleteTeamButton";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const OK_MSG: Record<string, string> = {
  updateTeam: "Team fields saved.",
  removePlayer: "Player removed back to the pool.",
  publishTeam: "Team published to families.",
  unpublishTeam: "Team unpublished.",
  requestSeasonFees: "Season fee requests sent.",
  resentAll: "Fee reminders resent to unpaid players.",
  addTeamCoach: "Coach added to the team.",
  removeTeamCoach: "Coach removed from the team.",
};

const ERR_MSG: Record<string, string> = {
  auth: "Not authorized to manage teams.",
  team: "Missing team.",
  coach: "Cannot assign this coach — not cleared (background check + onboarding required).",
  coachgate: "Cannot add this coach — not cleared (background check + onboarding required).",
  coachishead: "That coach is already the head coach of this team.",
  coachclash: "That coach already coaches another team at this day/time. Pick a non-overlapping slot or use “add anyway.”",
  player: "Missing player.",
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
  const { ok, err } = await searchParams;
  const ticket = await mintConsoleTicket();
  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      facility: true,
      division: true,
      coach: { include: { person: true } },
      assistantCoaches: { include: { coach: { include: { person: true } } } },
      members: { include: { person: true }, orderBy: { joinedAt: "asc" } },
      season: { include: { divisions: { orderBy: { name: "asc" } } } },
    },
  });
  if (!team) notFound();

  const [coaches, facilities] = await Promise.all([
    prisma.coach.findMany({ include: { person: true }, orderBy: { person: { lastName: "asc" } } }),
    prisma.facility.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
  ]);

  const roster = rosterStatus(team.members.length, team.coachPlays);
  const publish = canPublishTeam(team, team.facility, team.members.length);
  const missing = teamMissingFields(team);

  // How many rostered players still need a season-fee request?
  const memberIds = team.members.map((m) => m.personId);
  const existingFees = memberIds.length
    ? await prisma.payment.findMany({
        where: { partyId: { in: memberIds }, seasonId: team.seasonId, category: "PLAYER_FEE" },
        select: { partyId: true },
      })
    : [];
  const paidOrRequested = new Set(existingFees.map((p) => p.partyId));
  const feesToRequest = memberIds.filter((id) => !paidOrRequested.has(id)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/console/teams" className="text-sm text-brand-600 hover:underline">← Team build board</Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{team.name}</h1>
          <p className="text-sm text-slate-500">
            {team.origin === "ACP_CLUB" ? team.clubName ?? "Outside club" : "PURE Academy"} · {team.season.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton label="Print roster" />
          {team.published ? <StatusBadge status="PUBLISHED" /> : missing.length === 0 ? <StatusBadge status="READY" /> : <StatusBadge status="BUILDING" />}
        </div>
      </div>

      {ok && OK_MSG[ok] && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{OK_MSG[ok]}</div>
      )}
      {err && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{ERR_MSG[err] ?? "Something went wrong."}</div>
      )}

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
              <div className={`h-full ${roster.meetsMinimum ? "bg-emerald-500" : "bg-amber-400"}`}
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
                      <div className="text-sm font-medium text-slate-800">{m.person.firstName} {m.person.lastName}</div>
                      <div className="text-xs text-slate-400">
                        {m.person.duprRating ? `DUPR ${m.person.duprRating}` : "no rating"}
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
            {!roster.meetsMinimum && (
              <p className="mt-2 text-xs text-amber-600">Below minimum — need {roster.needed} more to launch.</p>
            )}
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
            ) : publish.ok ? (
              <div>
                <p className="mb-3 text-sm text-slate-600">Ready to publish. Families will see the team, coach, location, day, and time.</p>
                <ConfirmSubmit
                  action="/api/console/teams"
                  fields={{ ticket, op: "publishTeam", teamId: team.id }}
                  confirm={`Publish "${team.name}" to families? It becomes visible to players and parents.`}
                  label="Publish to families"
                  className="btn-primary text-sm"
                />
              </div>
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">🔒 {publish.reason}</p>
            )}
          </div>

          {/* Payment request — the assignment → payment-request sequence (§8) */}
          <div className="card">
            <h2 className="mb-2 font-semibold text-slate-900">Season fees</h2>
            {team.members.length === 0 ? (
              <p className="text-sm text-slate-400">No players to bill yet.</p>
            ) : (
              <div className="space-y-3">
                {feesToRequest === 0 ? (
                  <p className="text-sm text-emerald-700">All rostered players have a fee request or payment.</p>
                ) : (
                  <div>
                    <p className="mb-3 text-sm text-slate-600">
                      {feesToRequest} player{feesToRequest > 1 ? "s" : ""} not yet billed. Requesting
                      sends the season fee to their portal to pay.
                    </p>
                    <ConfirmSubmit
                      action="/api/console/teams"
                      fields={{ ticket, op: "requestSeasonFees", teamId: team.id }}
                      confirm={`Email the season fee request to ${feesToRequest} player${feesToRequest > 1 ? "s" : ""}?`}
                      label={`Request season fee (${feesToRequest})`}
                      className="btn-primary text-sm"
                    />
                  </div>
                )}
                {/* Resend to anyone already requested-but-unpaid. */}
                <form method="POST" action="/api/console/registrations">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="resendAllFees" />
                  <input type="hidden" name="teamId" value={team.id} />
                  <button className="text-xs font-semibold text-brand-700 hover:underline">Resend reminders to unpaid players</button>
                </form>
              </div>
            )}
          </div>
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
                <label className="label" htmlFor="coachId">Coach {team.origin === "ACP_CLUB" && <span className="text-xs text-slate-400">(optional for outside teams)</span>}</label>
                <select id="coachId" name="coachId" defaultValue={team.coachId ?? ""} className="input">
                  <option value="">—</option>
                  {coaches.map((c) => {
                    const gate = coachAssignmentGate(c);
                    return (
                      <option key={c.id} value={c.id} disabled={!gate.ok}>
                        {c.person.firstName} {c.person.lastName}{!gate.ok ? " (not cleared)" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              <Select label="Facility" name="facilityId" defaultValue={team.facilityId ?? ""}
                options={[{ value: "", label: "—" }, ...facilities.map((f) => ({ value: f.id, label: `${f.name}${f.agreementStatus !== "EXECUTED" ? " (agreement pending)" : ""}` }))]} />
              <Select label="Day" name="dayOfWeek" defaultValue={team.dayOfWeek ?? ""}
                options={[{ value: "", label: "—" }, ...WEEKDAYS.map((d) => ({ value: d, label: d }))]} />
              <Field label="Start time" name="startTime" type="time" defaultValue={team.startTime ?? ""} />
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
                        <option key={c.id} value={c.id} disabled={!gate.ok}>
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
