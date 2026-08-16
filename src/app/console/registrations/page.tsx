import Link from "next/link";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { StatusBadge } from "@/components/StatusBadge";
import { findDuplicateGroups } from "@/lib/domain/registrations";
import { AddPlayerForm } from "./AddPlayerForm";
import { RowActions } from "@/components/RowActions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { RegistrationsBulkBar } from "@/components/RegistrationsBulkBar";
import { requireAdmin } from "@/lib/rbac";
import { getSeasonStats, DEAD_REG_STATUS, UNASSIGNED_STATUS } from "@/lib/domain/seasonStats";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  addPlayer: "Player added to the roster.",
  assign: "Player assigned to the team.",
  unassign: "Player sent back to the pool.",
  fee: "Season fee requested.",
  feeexists: "That player already has a fee on file.",
  refund: "Refund started.",
  resent: "Fee request resent.",
  regDeleted: "Registration removed — the player was pulled from any team in that season.",
  merged: "Records merged into one.",
  bulkWaiver: "Waiver sent to the selected players.",
  bulkFee: "Season fee requested for the selected players.",
};
const ERRORS: Record<string, string> = {
  pickpair: "Pick two different records to merge.",
  coachmerge: "One of these is a coach — merge coach records from the Coaches page.",
  mergefail: "The merge couldn't complete and was rolled back — nothing changed.",
  notfound: "Record not found.",
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
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const seasonRows = await prisma.season.findMany({
    orderBy: [{ active: "desc" }, { startDate: "desc" }],
    include: { divisions: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  const seasons = seasonRows.map((s) => ({ id: s.id, name: s.name, program: s.program, divisions: s.divisions }));
  // Default the Add-a-player form to the active PURE Academy registration season
  // — never an ACP league or another season that merely sorts first.
  const defaultSeasonId =
    seasonRows.find((s) => s.active && s.program === "PURE_ACADEMY")?.id ??
    seasonRows.find((s) => s.program === "PURE_ACADEMY")?.id ??
    seasonRows.find((s) => s.active)?.id ??
    seasonRows[0]?.id ??
    "";

  // The one counting service — so the header counts here equal the dashboard's.
  const stats = await getSeasonStats();
  const scopeSeasonId = stats.season?.id ?? defaultSeasonId;

  const q = (sp.q ?? "").trim();
  // Faceted filters — division, location, waiver, payment, assignment. Each is a
  // server-side Prisma condition, ANDed together, so "everyone in Mesa without a
  // waiver" is one query, not a scroll. Base scope: the active season's live
  // registrations (withdrawn / duplicate / merged excluded), matching every
  // other console count.
  const filters: Record<string, unknown>[] = [
    { seasonId: scopeSeasonId },
    { status: { notIn: [...DEAD_REG_STATUS] } },
  ];
  if (q) filters.push({ person: { OR: [
    { firstName: { contains: q, mode: "insensitive" as const } },
    { lastName: { contains: q, mode: "insensitive" as const } },
    { email: { contains: q, mode: "insensitive" as const } },
    { phone: { contains: q, mode: "insensitive" as const } },
  ] } });
  if (sp.div) filters.push({ divisionId: sp.div });
  if (sp.loc) filters.push({ locationPrefs: { some: { facility: { market: sp.loc } } } });
  if (sp.waiver === "no") filters.push({ person: { waiverSignedAt: null } });
  if (sp.waiver === "yes") filters.push({ person: { waiverSignedAt: { not: null } } });
  if (sp.assign === "assigned") filters.push({ status: "ASSIGNED" });
  // "Unassigned" = the placement pool, same as the Assignment board/pools count
  // (awaiting placement = SUBMITTED ∪ WAITLISTED), not SUBMITTED alone.
  if (sp.assign === "unassigned") filters.push({ status: { in: [...UNASSIGNED_STATUS] } });
  if (sp.assign === "waitlisted") filters.push({ status: "WAITLISTED" });
  if (sp.pay === "unpaid") filters.push({ person: { paymentsMade: { none: { category: "PLAYER_FEE", status: "PAID" } } } });
  if (sp.pay === "paid") filters.push({ person: { paymentsMade: { some: { category: "PLAYER_FEE", status: "PAID" } } } });
  const where = filters.length ? { AND: filters } : {};

  const [registrations, divisionOpts, marketRows] = await Promise.all([
    prisma.registration.findMany({
      where,
      include: { person: true, division: true, locationPrefs: { orderBy: { rank: "asc" }, include: { facility: true } } },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.division.findMany({ where: { divisionType: { not: "LESSON" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.facility.findMany({ where: { archived: false, market: { not: null } }, select: { market: true } }),
  ]);
  const markets = [...new Set(marketRows.map((m) => m.market).filter(Boolean) as string[])].sort();
  const filtered = filters.length > 0;

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

  // Real per-record counts for the merge confirm, so it lists exactly what moves
  // (N registrations, team spots, payments/$, waivers) instead of a vague warning.
  const loserIds = dupGroups.flatMap((g) => g.slice(1)).map((p) => p.id);
  const mergeImpact = new Map<string, { regs: number; teams: number; pays: number; cents: number; waivers: number }>();
  if (loserIds.length) {
    const [regG, teamG, payG, waiverG] = await Promise.all([
      prisma.registration.groupBy({ by: ["personId"], where: { personId: { in: loserIds } }, _count: true }),
      prisma.teamMember.groupBy({ by: ["personId"], where: { personId: { in: loserIds } }, _count: true }),
      prisma.payment.groupBy({ by: ["partyId"], where: { partyId: { in: loserIds } }, _count: true, _sum: { amountCents: true } }),
      prisma.waiver.groupBy({ by: ["personId"], where: { personId: { in: loserIds } }, _count: true }),
    ]);
    for (const id of loserIds) mergeImpact.set(id, { regs: 0, teams: 0, pays: 0, cents: 0, waivers: 0 });
    for (const r of regG) { const m = mergeImpact.get(r.personId); if (m) m.regs = r._count; }
    for (const r of teamG) { const m = mergeImpact.get(r.personId); if (m) m.teams = r._count; }
    for (const r of payG) { const m = r.partyId ? mergeImpact.get(r.partyId) : null; if (m) { m.pays = r._count; m.cents = r._sum.amountCents ?? 0; } }
    for (const r of waiverG) { const m = mergeImpact.get(r.personId); if (m) m.waivers = r._count; }
  }
  const mergeSummary = (id: string, firstName: string, keepName: string): string => {
    const m = mergeImpact.get(id) ?? { regs: 0, teams: 0, pays: 0, cents: 0, waivers: 0 };
    const parts: string[] = [];
    if (m.regs) parts.push(`${m.regs} registration${m.regs === 1 ? "" : "s"}`);
    if (m.teams) parts.push(`${m.teams} team spot${m.teams === 1 ? "" : "s"}`);
    if (m.pays) parts.push(`${m.pays} payment${m.pays === 1 ? "" : "s"} ($${(m.cents / 100).toFixed(2)})`);
    if (m.waivers) parts.push(`${m.waivers} waiver${m.waivers === 1 ? "" : "s"}`);
    const moves = parts.length ? parts.join(", ") : "no attached records";
    return `Move ${firstName}'s ${moves} onto ${keepName}, then delete the duplicate ${firstName} record. This can't be undone — verify it's really the same person first.`;
  };

  // Header counts come straight from the counting service, so this page's totals
  // are identical to the dashboard's (active season, live registrations).
  const counts = {
    total: stats.registrations.live,
    assigned: stats.registrations.assigned,
    waitlisted: stats.registrations.waitlisted,
    noWaiver: stats.waiversOutstanding,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Registrations</h1>
          <p className="text-slate-500">
            {counts.total} total · {counts.assigned} assigned · {counts.waitlisted} waitlisted ·{" "}
            <span className={counts.noWaiver ? "text-amber-600 font-medium" : ""}>{counts.noWaiver} player{counts.noWaiver === 1 ? "" : "s"} without waiver</span>
          </p>
        </div>
        <AddPlayerForm ticket={ticket} seasons={seasons} defaultSeasonId={defaultSeasonId} />
      </div>

      {/* Search + faceted filters — division, location, waiver, payment, assignment */}
      <form method="GET" className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label text-xs">Search</label>
          <input name="q" defaultValue={q} placeholder="Name, email, or phone…" className="input max-w-xs" type="search" />
        </div>
        <div>
          <label className="label text-xs">Division</label>
          <select name="div" defaultValue={sp.div ?? ""} className="input py-1.5 text-sm">
            <option value="">All</option>
            {divisionOpts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs">Location</label>
          <select name="loc" defaultValue={sp.loc ?? ""} className="input py-1.5 text-sm">
            <option value="">All</option>
            {markets.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label text-xs">Waiver</label>
          <select name="waiver" defaultValue={sp.waiver ?? ""} className="input py-1.5 text-sm">
            <option value="">Any</option>
            <option value="no">No waiver</option>
            <option value="yes">Signed</option>
          </select>
        </div>
        <div>
          <label className="label text-xs">Payment</label>
          <select name="pay" defaultValue={sp.pay ?? ""} className="input py-1.5 text-sm">
            <option value="">Any</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div>
          <label className="label text-xs">Assignment</label>
          <select name="assign" defaultValue={sp.assign ?? ""} className="input py-1.5 text-sm">
            <option value="">Any</option>
            <option value="unassigned">Unassigned</option>
            <option value="assigned">Assigned</option>
            <option value="waitlisted">Waitlisted</option>
          </select>
        </div>
        <button className="btn-secondary">Apply</button>
        {filtered && <a href="/console/registrations" className="btn-ghost text-sm text-slate-500">Clear</a>}
      </form>
      {filtered && (
        <p className="text-sm text-slate-500">{registrations.length} matching registration{registrations.length === 1 ? "" : "s"}.</p>
      )}

      {sp.ok && OK[sp.ok] && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{OK[sp.ok]}</p>
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
            Matched on last name + a shared email or phone, allowing for first-name variants (Dave/David). The first
            record is kept; merging moves the other&apos;s registrations, teams, payments, waivers, messages, and notes
            onto it and deletes the duplicate. It runs in one transaction — if anything can&apos;t move, nothing changes.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {dupGroups.map((g, i) => {
              const keep = g[0];
              return (
                <li key={i} className="rounded-lg bg-amber-50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-slate-800">{keep.firstName} {keep.lastName}</span>
                    <span className="badge bg-emerald-100 text-emerald-800">keep</span>
                    <span className="text-xs text-slate-500">{keep.email ?? keep.phone ?? "—"}</span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {g.slice(1).map((p) => {
                      const m = mergeImpact.get(p.id);
                      return (
                        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-slate-600">
                            {p.firstName} {p.lastName}
                            <span className="ml-2 text-xs text-slate-400">{p.email ?? p.phone ?? "—"}</span>
                            {m && (m.regs + m.teams + m.pays + m.waivers > 0) && (
                              <span className="ml-2 text-xs text-slate-500">
                                (moves {[
                                  m.regs && `${m.regs} reg`,
                                  m.teams && `${m.teams} team`,
                                  m.pays && `$${(m.cents / 100).toFixed(0)}`,
                                  m.waivers && `${m.waivers} waiver`,
                                ].filter(Boolean).join(" · ")})
                              </span>
                            )}
                          </span>
                          <ConfirmSubmit
                            action="/api/console/people"
                            fields={{ ticket, op: "mergePeople", survivorId: keep.id, loserId: p.id, returnTo: "/console/registrations" }}
                            label={`Merge into ${keep.firstName}`}
                            confirm={mergeSummary(p.id, p.firstName, `${keep.firstName} ${keep.lastName}`)}
                            confirmTitle="Merge duplicate records?"
                            confirmLabel="Merge & delete duplicate"
                            danger
                            className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          />
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* The hidden form the row checkboxes and the bulk bar post through. */}
      <form id="regbulk" method="POST" action="/api/console/registrations" className="hidden" />
      <RegistrationsBulkBar ticket={ticket} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="w-8 py-2"></th>
              <th className="py-2">Player</th>
              <th className="hidden sm:table-cell">Division</th>
              <th className="hidden md:table-cell">Location prefs</th>
              <th className="hidden sm:table-cell">Waiver</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {registrations.map((r) => (
              <tr key={r.id}>
                <td className="py-2 align-top">
                  <input type="checkbox" name="ids" value={r.id} data-regbox form="regbulk" className="mt-1 h-4 w-4" aria-label={`Select ${r.person.firstName} ${r.person.lastName}`} />
                </td>
                <td className="py-2">
                  <Link href={`/console/registrations/${r.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                    {r.person.firstName} {r.person.lastName}
                  </Link>
                  <div className="text-xs text-slate-400">{r.person.email ?? r.person.phone ?? "—"}</div>
                </td>
                <td className="hidden text-slate-600 sm:table-cell">{r.division?.name ?? <span className="text-slate-400">unplaced</span>}</td>
                <td className="hidden text-slate-600 md:table-cell">
                  {r.locationPrefs.length
                    ? r.locationPrefs.map((lp) => lp.facility?.name ?? lp.marketName).filter(Boolean).join(" › ")
                    : "—"}
                </td>
                <td className="hidden sm:table-cell">
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
                    waiverSigned={!!r.person.waiverSignedAt}
                  />
                </td>
              </tr>
            ))}
            {registrations.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400">{filtered ? "No registrations match these filters." : "No registrations yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
