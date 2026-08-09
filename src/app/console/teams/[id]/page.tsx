import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { rosterStatus, canPublishTeam, teamMissingFields, coachAssignmentGate } from "@/lib/domain/teams";
import { TEAM_CAP, WEEKDAYS } from "@/lib/enums";
import { mintConsoleTicket } from "@/lib/auth";

export const dynamic = "force-dynamic";

const OK_MSG: Record<string, string> = {
  updateTeam: "Team fields saved.",
  removePlayer: "Player removed back to the pool.",
  publishTeam: "Team published to families.",
  unpublishTeam: "Team unpublished.",
  requestSeasonFees: "Season fee requests sent.",
};

const ERR_MSG: Record<string, string> = {
  auth: "Not authorized to manage teams.",
  team: "Missing team.",
  coach: "Cannot assign this coach — not cleared (background check + onboarding required).",
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
      members: { include: { person: true }, orderBy: { joinedAt: "asc" } },
      season: { include: { divisions: { orderBy: { name: "asc" } } } },
    },
  });
  if (!team) notFound();

  const [coaches, facilities] = await Promise.all([
    prisma.coach.findMany({ include: { person: true }, orderBy: { person: { lastName: "asc" } } }),
    prisma.facility.findMany({ orderBy: { name: "asc" } }),
  ]);

  const roster = rosterStatus(team.members.length, team.coachPlays);
  const publish = canPublishTeam(team, team.facility);
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
          {team.published ? <StatusBadge status="PUBLISHED" /> : missing.length === 0 ? <span className="badge bg-emerald-100 text-emerald-800">ready</span> : <span className="badge bg-amber-100 text-amber-800">building</span>}
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
                    <form method="POST" action="/api/console/teams">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="removePlayer" />
                      <input type="hidden" name="teamId" value={team.id} />
                      <input type="hidden" name="personId" value={m.personId} />
                      <button className="text-xs text-rose-600 hover:underline">remove</button>
                    </form>
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
                <p className="text-sm text-emerald-700">Published to families{team.publishedAt ? ` on ${team.publishedAt.toLocaleDateString()}` : ""}.</p>
                <form method="POST" action="/api/console/teams" className="mt-3">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="unpublishTeam" />
                  <input type="hidden" name="teamId" value={team.id} />
                  <button className="btn-ghost text-sm">Unpublish</button>
                </form>
              </>
            ) : publish.ok ? (
              <form method="POST" action="/api/console/teams">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="publishTeam" />
                <input type="hidden" name="teamId" value={team.id} />
                <p className="mb-3 text-sm text-slate-600">Ready to publish. Families will see the team, coach, location, day, and time.</p>
                <button className="btn-primary text-sm">Publish to families</button>
              </form>
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">🔒 {publish.reason}</p>
            )}
          </div>

          {/* Payment request — the assignment → payment-request sequence (§8) */}
          <div className="card">
            <h2 className="mb-2 font-semibold text-slate-900">Season fees</h2>
            {team.members.length === 0 ? (
              <p className="text-sm text-slate-400">No players to bill yet.</p>
            ) : feesToRequest === 0 ? (
              <p className="text-sm text-emerald-700">All rostered players have a fee request or payment.</p>
            ) : (
              <form method="POST" action="/api/console/teams">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="requestSeasonFees" />
                <input type="hidden" name="teamId" value={team.id} />
                <p className="mb-3 text-sm text-slate-600">
                  {feesToRequest} player{feesToRequest > 1 ? "s" : ""} not yet billed. Requesting
                  sends the season fee to their portal to pay.
                </p>
                <button className="btn-primary text-sm">Request season fee ({feesToRequest})</button>
              </form>
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

            <div className="flex justify-end">
              <button className="btn-primary">Save team</button>
            </div>
          </form>
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
