import "server-only";
import { prisma } from "@/lib/db";
import { assignedPlayerIds } from "@/lib/domain/pnl";

// The Payments "Placement & payment" drill-down: who's on a team vs paying, with
// each person's season-fee status, apparel choice/payment, their registration,
// and enough to resend a pay link. Built so an admin can chase exactly the gaps
// (a rostered player who hasn't paid, or picked apparel but hasn't paid for it).

export type ApparelInfo = { chosen: boolean; paid: boolean; items: string[] };
export type PersonPayRow = {
  personId: string;
  name: string;
  registrationId: string | null;
  teamName: string | null;
  feePaid: boolean;
  onPlan: boolean;
  owedCents: number;
  /** Fee waived — comped / no charge ($0). Counts as settled, owes nothing. */
  waived: boolean;
  apparel: ApparelInfo;
};
export type PlacementPeople = {
  seasonId: string | null;
  assignedPaid: PersonPayRow[];      // on a team, fee paid or paying on a plan
  assignedUnpaid: PersonPayRow[];    // on a team, still owes
  unplacedPaidInFull: PersonPayRow[];// not on a team, fee paid
  unplacedOnPlan: PersonPayRow[];    // not on a team, on a plan
};

const coversOf = (p: { coveredPersonIds: unknown; partyId: string | null }): string[] => {
  const ids = Array.isArray(p.coveredPersonIds) ? (p.coveredPersonIds as unknown[]).map(String).filter(Boolean) : [];
  return ids.length ? ids : p.partyId ? [p.partyId] : [];
};

export async function placementPaymentPeople(): Promise<PlacementPeople> {
  const season =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, select: { id: true } }));
  if (!season) return { seasonId: null, assignedPaid: [], assignedUnpaid: [], unplacedPaidInFull: [], unplacedOnPlan: [] };

  const [assigned, regs, members, feePays, apparel] = await Promise.all([
    assignedPlayerIds(),
    prisma.registration.findMany({ where: { seasonId: season.id }, select: { id: true, personId: true, feeWaived: true } }),
    prisma.teamMember.findMany({ where: { team: { seasonId: season.id, isTest: false } }, select: { personId: true, team: { select: { name: true } } } }),
    prisma.payment.findMany({
      where: { direction: "IN", category: "PLAYER_FEE" },
      select: { amountCents: true, status: true, installmentPlan: true, installmentsPaid: true, installmentsTotal: true, partyId: true, coveredPersonIds: true },
    }),
    prisma.apparelOrderItem.findMany({ select: { personId: true, garment: true, size: true, quantity: true, payment: { select: { status: true } } } }),
  ]);

  const regByPerson = new Map(regs.map((r) => [r.personId, r.id]));
  const waivedPeople = new Set(regs.filter((r) => r.feeWaived).map((r) => r.personId));
  const teamByPerson = new Map(members.map((m) => [m.personId, m.team.name]));

  // Per-person season-fee status.
  type Fee = { paid: boolean; onPlan: boolean; owedCents: number };
  const feeByPerson = new Map<string, Fee>();
  for (const p of feePays) {
    for (const pid of coversOf(p)) {
      const cur = feeByPerson.get(pid) ?? { paid: false, onPlan: false, owedCents: 0 };
      if (p.status === "PAID") cur.paid = true;
      else if (p.installmentPlan && (p.installmentsPaid ?? 0) >= 1) {
        cur.onPlan = true;
        const total = p.installmentsTotal ?? 3;
        const per = Math.round(p.amountCents / total);
        cur.owedCents += per * Math.max(0, total - Math.min(p.installmentsPaid ?? 1, total));
      } else if (p.status === "REQUESTED" || p.status === "PENDING") {
        cur.owedCents += p.amountCents;
      }
      feeByPerson.set(pid, cur);
    }
  }

  // Per-person apparel.
  const apparelByPerson = new Map<string, ApparelInfo>();
  for (const a of apparel) {
    if (!a.personId) continue;
    const cur = apparelByPerson.get(a.personId) ?? { chosen: false, paid: false, items: [] };
    cur.chosen = true;
    if (a.payment?.status === "PAID") cur.paid = true;
    cur.items.push(`${a.garment === "TANK" ? "Tank" : "Shirt"} ${a.size}${a.quantity > 1 ? ` ×${a.quantity}` : ""}`);
    apparelByPerson.set(a.personId, cur);
  }

  // Names for everyone we'll list.
  const pidSet = new Set<string>([...assigned, ...feeByPerson.keys()]);
  const people = pidSet.size
    ? await prisma.person.findMany({ where: { id: { in: [...pidSet] } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameById = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));

  const row = (pid: string): PersonPayRow => {
    const fee = feeByPerson.get(pid) ?? { paid: false, onPlan: false, owedCents: 0 };
    const waived = waivedPeople.has(pid);
    return {
      personId: pid,
      name: nameById.get(pid) ?? "Unknown",
      registrationId: regByPerson.get(pid) ?? null,
      teamName: teamByPerson.get(pid) ?? null,
      // A waived (no-charge) player owes nothing and counts as settled.
      feePaid: fee.paid || waived,
      onPlan: fee.onPlan,
      owedCents: waived ? 0 : fee.owedCents,
      waived,
      apparel: apparelByPerson.get(pid) ?? { chosen: false, paid: false, items: [] },
    };
  };
  const byName = (a: PersonPayRow, b: PersonPayRow) => a.name.localeCompare(b.name);

  const assignedPaid: PersonPayRow[] = [];
  const assignedUnpaid: PersonPayRow[] = [];
  for (const pid of assigned) {
    const r = row(pid);
    (r.feePaid || r.onPlan ? assignedPaid : assignedUnpaid).push(r);
  }
  const unplacedPaidInFull: PersonPayRow[] = [];
  const unplacedOnPlan: PersonPayRow[] = [];
  for (const [pid, fee] of feeByPerson) {
    if (assigned.has(pid)) continue;
    if (fee.paid) unplacedPaidInFull.push(row(pid));
    else if (fee.onPlan) unplacedOnPlan.push(row(pid));
  }

  return {
    seasonId: season.id,
    assignedPaid: assignedPaid.sort(byName),
    assignedUnpaid: assignedUnpaid.sort(byName),
    unplacedPaidInFull: unplacedPaidInFull.sort(byName),
    unplacedOnPlan: unplacedOnPlan.sort(byName),
  };
}
