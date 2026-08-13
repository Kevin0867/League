import Link from "next/link";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { TEAM_CAP } from "@/lib/enums";

export const dynamic = "force-dynamic";

type TeamOption = { id: string; name: string; full: boolean };

// A compact "move to team" control: a team dropdown + Go, posting to the shared
// registrations action. Used three ways on this page — move the requester, move
// one matched player, or (with partnerPersonId set) move BOTH onto one team via
// the assignPair op. Admins can always override a full team here, so a pairing
// request can be honored onto a team that's already at cap.
function TeamMovePicker({
  ticket,
  teamOptions,
  personId,
  registrationId,
  partnerPersonId,
  currentTeamId,
  label,
}: {
  ticket: string;
  teamOptions: TeamOption[];
  personId: string;
  registrationId?: string;
  partnerPersonId?: string;
  currentTeamId?: string | null;
  label: string;
}) {
  const op = partnerPersonId ? "assignPair" : "assignToTeam";
  return (
    <form method="POST" action="/api/console/registrations" className="flex items-center gap-1">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="from" value="requests" />
      <input type="hidden" name="personId" value={personId} />
      {registrationId && <input type="hidden" name="registrationId" value={registrationId} />}
      {partnerPersonId && <input type="hidden" name="partnerPersonId" value={partnerPersonId} />}
      {/* Explicit admin move — allow exceeding the cap to honor the request. */}
      <input type="hidden" name="override" value="1" />
      <select name="teamId" defaultValue="" required className="input py-1 text-xs">
        <option value="" disabled>{label}</option>
        {teamOptions.map((t) => (
          <option key={t.id} value={t.id} disabled={t.id === currentTeamId}>
            {t.name}{t.full ? " · full" : ""}{t.id === currentTeamId ? " · current" : ""}
          </option>
        ))}
      </select>
      <button className="btn-secondary text-xs">Go</button>
    </form>
  );
}

// Placement requests: read the free-text comments a family left at signup
// ("wants to play with Mary", "coached by Coach Lee") and help an admin honor
// them — matching the named player/coach, showing where they're placed, and
// flagging conflicts (friend's team full, requested coach elsewhere).
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, orderBy: { startDate: "desc" } });
  if (!season) {
    return <div className="card text-sm text-slate-500">No active PURE Academy season.</div>;
  }

  const regs = await prisma.registration.findMany({
    where: { seasonId: season.id },
    include: { person: true, division: true },
  });
  const memberships = await prisma.teamMember.findMany({
    where: { team: { seasonId: season.id } },
    include: { team: { include: { coach: { include: { person: true } }, _count: { select: { members: true } } } } },
  });
  const teamByPerson = new Map(memberships.map((m) => [m.personId, m.team]));
  const teams = await prisma.team.findMany({ where: { seasonId: season.id }, include: { coach: { include: { person: true } }, _count: { select: { members: true } } } });
  const coaches = await prisma.coach.findMany({ include: { person: true } });
  const teamOptions = teams
    .map((t) => ({ id: t.id, name: t.name, full: t._count.members + (t.coachPlays ? 1 : 0) + 1 > TEAM_CAP }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Name index for matching mentions in the comment text.
  const norm = (s: string) => s.toLowerCase();
  const words = (s: string) => new Set(norm(s).split(/[^a-z]+/).filter((w) => w.length >= 3));
  const SIBLING_RE = /\b(brothers?|sisters?|siblings?|twins?)\b/i;
  const requests = regs
    .filter((r) => (r.partnerRequests ?? "").trim().length > 0)
    .map((r) => {
      const text = r.partnerRequests!.trim();
      const w = words(text);
      const self = r.person;
      const mentionsSibling = SIBLING_RE.test(text);

      // Named matches: a fellow player whose first name appears in the comment.
      const named = regs
        .filter((o) => o.personId !== r.personId && w.has(norm(o.person.firstName)))
        .map((o) => ({ person: o.person, regId: o.id, team: teamByPerson.get(o.personId) ?? null, reason: "named" as const }));

      // Likely siblings: when the comment says brother/sister/sibling/twin but
      // names no one, surface same-family players — same last name, or a shared
      // guardian (or a direct parent/child link) — as candidates to review.
      const siblingCandidates = mentionsSibling
        ? regs
            .filter((o) => o.personId !== r.personId)
            .filter((o) => {
              const p = o.person;
              const sameLast = !!self.lastName && norm(p.lastName) === norm(self.lastName);
              const sharedGuardian = !!self.guardianId && !!p.guardianId && self.guardianId === p.guardianId;
              const parentChild = (!!self.guardianId && self.guardianId === p.id) || (!!p.guardianId && p.guardianId === self.id);
              return sameLast || sharedGuardian || parentChild;
            })
            .map((o) => ({ person: o.person, regId: o.id, team: teamByPerson.get(o.personId) ?? null, reason: "sibling" as const }))
        : [];

      // Named matches win; add sibling candidates not already named. De-dup by id.
      const namedIds = new Set(named.map((n) => n.person.id));
      const candidates = [...named, ...siblingCandidates.filter((s) => !namedIds.has(s.person.id))]
        .filter((v, i, a) => a.findIndex((x) => x.person.id === v.person.id) === i)
        .slice(0, 8);

      // Matched coach mentions.
      const coach = coaches.find((c) => w.has(norm(c.person.firstName)) || w.has(norm(c.person.lastName)));
      return { reg: r, text, candidates, mentionsSibling, coach, myTeam: teamByPerson.get(r.personId) ?? null };
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Placement requests</h1>
        <p className="text-slate-500">
          Comments left at signup — pairing, sibling, and coach requests. Named friends match automatically; a
          &ldquo;brother/sister&rdquo; mention surfaces same-family players. Place a player in one click; admins can override a full team.
        </p>
      </div>

      {sp.ok === "assign" && <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">Player placed.</p>}
      {sp.ok === "override" && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Player placed above the team cap (admin override).</p>}
      {sp.err === "cap" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">That team is full — use “Place anyway” to override the cap.</p>}

      {requests.length === 0 ? (
        <div className="card text-sm text-slate-500">No placement comments on this season&apos;s registrations.</div>
      ) : (
        <div className="space-y-3">
          {requests.map(({ reg, text, candidates, mentionsSibling, coach, myTeam }) => (
            <div key={reg.id} className="card space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/console/registrations/${reg.id}`} className="font-semibold text-slate-900 hover:underline">
                    {reg.person.firstName} {reg.person.lastName}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {reg.division?.name ?? "unplaced"} · {myTeam ? `on ${myTeam.name}` : "in pool"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {mentionsSibling && <span className="badge bg-violet-100 text-violet-800">👧👦 sibling request</span>}
                  {/* Move just the requester to any team (or off their current one). */}
                  <TeamMovePicker
                    ticket={ticket}
                    teamOptions={teamOptions}
                    personId={reg.person.id}
                    registrationId={reg.id}
                    currentTeamId={myTeam?.id ?? null}
                    label={myTeam ? "Move to team…" : "Place on team…"}
                  />
                </div>
              </div>

              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{text}”</p>

              {/* Matched players + likely siblings */}
              {candidates.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {candidates.some((c) => c.reason === "sibling") ? "Matches & likely family" : `Matched player${candidates.length > 1 ? "s" : ""}`}
                  </div>
                  {candidates.map(({ person, regId, team, reason }) => {
                    const full = team ? team._count.members + (team.coachPlays ? 1 : 0) + 1 > TEAM_CAP : false;
                    const together = !!team && !!myTeam && myTeam.id === team.id;
                    return (
                      <div key={person.id} className="space-y-2 rounded-lg ring-1 ring-slate-100 px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-slate-700">
                            {person.firstName} {person.lastName}
                            {reason === "sibling" && <span className="ml-2 badge bg-violet-50 text-violet-700">likely sibling</span>}
                            <span className="ml-2 text-xs text-slate-400">{team ? `on ${team.name}${full ? " · FULL" : ""}` : "in pool"}</span>
                          </span>
                          {together ? (
                            <span className="badge bg-emerald-100 text-emerald-800">together ✓</span>
                          ) : team && myTeam?.id !== team.id ? (
                            // One click to move the requester onto this player's team.
                            <form method="POST" action="/api/console/registrations">
                              <input type="hidden" name="ticket" value={ticket} />
                              <input type="hidden" name="op" value="assignToTeam" />
                              <input type="hidden" name="from" value="requests" />
                              <input type="hidden" name="personId" value={reg.person.id} />
                              <input type="hidden" name="registrationId" value={reg.id} />
                              <input type="hidden" name="teamId" value={team.id} />
                              {full && <input type="hidden" name="override" value="1" />}
                              <button className={full ? "btn-secondary text-xs text-amber-700 ring-amber-200" : "btn-primary text-xs"}>
                                {full ? `Move ${reg.person.firstName} here (override cap)` : `Move ${reg.person.firstName} to ${team.name}`}
                              </button>
                            </form>
                          ) : null}
                        </div>
                        {/* Fine-grained moves: this player alone, or both players onto one team. */}
                        {!together && (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <TeamMovePicker
                              ticket={ticket}
                              teamOptions={teamOptions}
                              personId={person.id}
                              registrationId={regId}
                              currentTeamId={team?.id ?? null}
                              label={`Move ${person.firstName}…`}
                            />
                            <TeamMovePicker
                              ticket={ticket}
                              teamOptions={teamOptions}
                              personId={reg.person.id}
                              registrationId={reg.id}
                              partnerPersonId={person.id}
                              label="Place both on…"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {mentionsSibling && (
                    <p className="text-xs text-slate-400">Family suggested from a sibling mention — confirm it&apos;s the right person before placing.</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  {mentionsSibling
                    ? "Mentions a sibling, but no same-family player is registered yet — check back once they enroll, or place manually."
                    : "No registered player matched by name — review the comment and place manually."}
                </p>
              )}

              {/* Matched coach + conflict flag */}
              {coach && (
                <div className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
                  Requested coach: <span className="font-medium">{coach.person.firstName} {coach.person.lastName}</span>.
                  {myTeam
                    ? myTeam.coachId === coach.id
                      ? " ✓ already on this coach's team."
                      : ` ⚠ current team's coach is ${myTeam.coach ? `${myTeam.coach.person.firstName} ${myTeam.coach.person.lastName}` : "unassigned"} — resolve if the coach matters more than the pairing.`
                    : ` Their teams: ${teams.filter((t) => t.coachId === coach.id).map((t) => t.name).join(", ") || "none yet"}.`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
