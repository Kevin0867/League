import Link from "next/link";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { findDuplicateGroups } from "@/lib/domain/registrations";
import { AddPlayerForm } from "./AddPlayerForm";
import { RowActions } from "@/components/RowActions";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  addPlayer: "Player added to the roster.",
  assign: "Player assigned to the team.",
  unassign: "Player sent back to the pool.",
  fee: "Season fee requested.",
  feeexists: "That player already has a fee on file.",
  refund: "Refund started.",
  resent: "Fee request resent.",
};
const ERRORS: Record<string, string> = {
  name: "First and last name are required.",
  contact: "An email or phone number is required.",
  auth: "You don't have permission to do that.",
  failed: "Could not add the player — please try again.",
  team: "Select a team to assign.",
  cap: "That team is already full.",
  norefund: "No paid fee to refund for this player.",
  refundfail: "The refund could not be processed — check Stripe.",
  fields: "Missing information.",
  op: "Unknown action.",
};

export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const seasonRows = await prisma.season.findMany({
    orderBy: [{ active: "desc" }, { startDate: "desc" }],
    include: { divisions: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  const seasons = seasonRows.map((s) => ({ id: s.id, name: s.name, divisions: s.divisions }));

  const registrations = await prisma.registration.findMany({
    include: { person: true, division: true, locationPrefs: { orderBy: { rank: "asc" }, include: { facility: true } } },
    orderBy: { submittedAt: "desc" },
  });

  // Roster quick-action context: teams per season, each player's current team,
  // and their fee status — so each row can assign/move/request/refund.
  const personIds = [...new Set(registrations.map((r) => r.person.id))];
  const [teamRows, memberships, payments] = await Promise.all([
    prisma.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, seasonId: true } }),
    prisma.teamMember.findMany({ where: { personId: { in: personIds } }, select: { personId: true, teamId: true, team: { select: { seasonId: true } } } }),
    prisma.payment.findMany({ where: { partyId: { in: personIds }, category: "PLAYER_FEE" }, select: { partyId: true, seasonId: true, status: true } }),
  ]);
  const teamsBySeason = new Map<string, { id: string; name: string }[]>();
  for (const t of teamRows) {
    const list = teamsBySeason.get(t.seasonId) ?? [];
    list.push({ id: t.id, name: t.name });
    teamsBySeason.set(t.seasonId, list);
  }
  const teamByPersonSeason = new Map<string, string>();
  for (const m of memberships) teamByPersonSeason.set(`${m.personId}:${m.team.seasonId}`, m.teamId);
  const payByPersonSeason = new Map<string, string>();
  for (const p of payments) {
    // Prefer the most significant status (PAID > REFUNDED > REQUESTED/PENDING).
    const key = `${p.partyId}:${p.seasonId}`;
    const rank = (s: string) => (s === "PAID" ? 3 : s === "REFUNDED" ? 2 : 1);
    const cur = payByPersonSeason.get(key);
    if (!cur || rank(p.status) > rank(cur)) payByPersonSeason.set(key, p.status);
  }
  const payStatusOf = (personId: string, seasonId: string): "none" | "requested" | "paid" | "refunded" => {
    const s = payByPersonSeason.get(`${personId}:${seasonId}`);
    if (s === "PAID") return "paid";
    if (s === "REFUNDED") return "refunded";
    if (s === "REQUESTED" || s === "PENDING") return "requested";
    return "none";
  };

  const people = registrations.map((r) => ({
    id: r.person.id,
    firstName: r.person.firstName,
    lastName: r.person.lastName,
    email: r.person.email,
    phone: r.person.phone,
  }));
  const dupGroups = findDuplicateGroups(people);

  const counts = {
    total: registrations.length,
    assigned: registrations.filter((r) => r.status === "ASSIGNED").length,
    waitlisted: registrations.filter((r) => r.status === "WAITLISTED").length,
    noWaiver: registrations.filter((r) => !r.person.waiverSignedAt).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Registrations</h1>
          <p className="text-slate-500">
            {counts.total} total · {counts.assigned} assigned · {counts.waitlisted} waitlisted ·{" "}
            <span className={counts.noWaiver ? "text-amber-600 font-medium" : ""}>{counts.noWaiver} without waiver</span>
          </p>
        </div>
        <AddPlayerForm ticket={ticket} seasons={seasons} />
      </div>

      {sp.ok && OK[sp.ok] && (
        <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800">{OK[sp.ok]}</p>
      )}
      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {ERRORS[sp.err] ?? "Something went wrong."}
        </p>
      )}

      {dupGroups.length > 0 && (
        <div className="card border-l-4 border-amber-400">
          <h2 className="font-semibold text-amber-800">
            Possible duplicates ({dupGroups.length} group{dupGroups.length > 1 ? "s" : ""})
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Match on name plus email or phone. Merge to the highest band registered
            while preserving all location and time preferences (§3).
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {dupGroups.map((g, i) => (
              <li key={i} className="rounded-lg bg-amber-50 px-3 py-2">
                {g.map((p) => `${p.firstName} ${p.lastName}`).join("  ·  ")}
                <span className="ml-2 text-xs text-slate-500">
                  ({g.map((p) => p.email ?? p.phone ?? "—").join(", ")})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-2">Player</th>
              <th>Division</th>
              <th>Location prefs</th>
              <th>Waiver</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {registrations.map((r) => (
              <tr key={r.id}>
                <td className="py-2">
                  <Link href={`/console/registrations/${r.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                    {r.person.firstName} {r.person.lastName}
                  </Link>
                  <div className="text-xs text-slate-400">{r.person.email ?? r.person.phone ?? "—"}</div>
                </td>
                <td className="text-slate-600">{r.division?.name ?? <span className="text-slate-400">unplaced</span>}</td>
                <td className="text-slate-600">
                  {r.locationPrefs.length
                    ? r.locationPrefs.map((lp) => lp.facility?.name ?? lp.marketName).filter(Boolean).join(" › ")
                    : "—"}
                </td>
                <td>
                  {r.person.waiverSignedAt
                    ? <span className="badge bg-emerald-100 text-emerald-800">signed</span>
                    : <span className="badge bg-amber-100 text-amber-800">outstanding</span>}
                </td>
                <td><StatusBadge status={r.status} /></td>
                <td className="text-right">
                  <RowActions
                    ticket={ticket}
                    personId={r.person.id}
                    registrationId={r.id}
                    assigned={r.status === "ASSIGNED"}
                    currentTeamId={teamByPersonSeason.get(`${r.person.id}:${r.seasonId}`) ?? null}
                    teams={teamsBySeason.get(r.seasonId) ?? []}
                    payStatus={payStatusOf(r.person.id, r.seasonId)}
                  />
                </td>
              </tr>
            ))}
            {registrations.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-slate-400">No registrations yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
