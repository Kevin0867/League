import "server-only";
import { prisma } from "@/lib/db";
import { makeCoveredPlayersResolver } from "@/lib/domain/placementPayment";

// Two roster registers for the Reports page and CSV export:
//  • Team assignments — every placed player, their team, coach, when/where, and
//    fee + waiver status.
//  • Waitlist — everyone waiting for a full team, in order, with their status.
// Both scoped to the active PURE Academy season and exclude test teams.

const DAY_LABEL: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };
const DAY_ORDER: Record<string, number> = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };

function fmtTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return t;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

export type AssignmentRow = {
  personId: string;
  player: string;
  email: string | null;
  phone: string | null;
  teamId: string;
  team: string;
  division: string;
  coach: string;
  location: string;
  daySort: number;
  dayTime: string;
  waiver: "signed" | "pending";
  fee: "paid" | "subscription" | "owes" | "no charge" | "—";
};

async function activeSeasonId(): Promise<string | null> {
  const s =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, select: { id: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, select: { id: true } }));
  return s?.id ?? null;
}

/** Every placed (rostered) player in the active season, with team + fee + waiver. */
export async function teamAssignmentReport(): Promise<AssignmentRow[]> {
  const seasonId = await activeSeasonId();
  if (!seasonId) return [];

  const [members, regs, feePays, resolve] = await Promise.all([
    prisma.teamMember.findMany({
      where: { team: { seasonId, isTest: false } },
      select: {
        personId: true,
        person: { select: { firstName: true, lastName: true, email: true, phone: true, waiverSignedAt: true } },
        team: {
          select: {
            id: true, name: true, dayOfWeek: true, startTime: true,
            division: { select: { name: true } }, divisionCode: true,
            facility: { select: { name: true } },
            coach: { select: { person: { select: { firstName: true, lastName: true } } } },
            assistantCoaches: { select: { coach: { select: { person: { select: { firstName: true, lastName: true } } } } } },
          },
        },
      },
    }),
    prisma.registration.findMany({ where: { seasonId, feeWaived: true }, select: { personId: true } }),
    prisma.payment.findMany({
      where: { direction: "IN", category: "PLAYER_FEE", status: { notIn: ["REFUNDED", "CANCELLED"] } },
      select: { status: true, installmentPlan: true, installmentsPaid: true, partyId: true, coveredPersonIds: true },
    }),
    makeCoveredPlayersResolver(seasonId),
  ]);

  const waived = new Set(regs.map((r) => r.personId));
  // Per-player fee status from every fee that covers them (paid ▸ subscription ▸ owes).
  const feeByPerson = new Map<string, "paid" | "subscription" | "owes">();
  for (const p of feePays) {
    for (const pid of resolve(p)) {
      const cur = feeByPerson.get(pid);
      if (p.status === "PAID") feeByPerson.set(pid, "paid");
      else if (p.installmentPlan && (p.installmentsPaid ?? 0) >= 1) { if (cur !== "paid") feeByPerson.set(pid, "subscription"); }
      else if (["REQUESTED", "PENDING", "FAILED"].includes(p.status)) { if (!cur) feeByPerson.set(pid, "owes"); }
    }
  }

  const rows: AssignmentRow[] = members.map((m) => {
    const t = m.team;
    // Head coach first, then any assistants — the full coaching staff on the team.
    const head = t.coach ? `${t.coach.person.firstName} ${t.coach.person.lastName}`.trim() : "";
    const assistants = t.assistantCoaches.map((a) => `${a.coach.person.firstName} ${a.coach.person.lastName}`.trim()).filter(Boolean);
    const coach = [head, ...assistants].filter(Boolean).join(", ");
    const fee: AssignmentRow["fee"] = waived.has(m.personId) ? "no charge" : feeByPerson.get(m.personId) ?? "—";
    return {
      personId: m.personId,
      player: `${m.person.firstName} ${m.person.lastName}`.trim(),
      email: m.person.email,
      phone: m.person.phone,
      teamId: t.id,
      team: t.name,
      division: t.division?.name ?? t.divisionCode ?? "—",
      coach,
      location: t.facility?.name ?? "—",
      daySort: t.dayOfWeek ? DAY_ORDER[t.dayOfWeek] ?? 99 : 99,
      dayTime: t.dayOfWeek ? `${DAY_LABEL[t.dayOfWeek] ?? t.dayOfWeek} ${fmtTime(t.startTime)}`.trim() : "—",
      waiver: m.person.waiverSignedAt ? "signed" : "pending",
      fee,
    };
  });
  // Sort by team, then day/time, then player.
  rows.sort((a, b) => a.team.localeCompare(b.team) || a.daySort - b.daySort || a.player.localeCompare(b.player));
  return rows;
}

export type WaitlistRow = {
  personId: string;
  player: string;
  email: string | null;
  phone: string | null;
  teamId: string;
  team: string;
  position: number;
  status: string;
  note: string | null;
  addedAt: Date;
};

/** Everyone on a team waitlist in the active season, in order, with their status. */
export async function waitlistReport(): Promise<WaitlistRow[]> {
  const seasonId = await activeSeasonId();
  if (!seasonId) return [];

  const teams = await prisma.team.findMany({ where: { seasonId, isTest: false }, select: { id: true, name: true } });
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const teamIds = teams.map((t) => t.id);
  if (!teamIds.length) return [];

  const entries = await prisma.teamWaitlist.findMany({
    where: { teamId: { in: teamIds } },
    orderBy: [{ teamId: "asc" }, { createdAt: "asc" }],
  });
  if (!entries.length) return [];

  const personIds = [...new Set(entries.map((e) => e.personId))];
  const people = await prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } });
  const personById = new Map(people.map((p) => [p.id, p]));

  // Position = order within each team (waiting entries lead, in sign-up order).
  const posByTeam = new Map<string, number>();
  const rows: WaitlistRow[] = entries.map((e) => {
    const pos = (posByTeam.get(e.teamId) ?? 0) + 1;
    posByTeam.set(e.teamId, pos);
    const p = personById.get(e.personId);
    return {
      personId: e.personId,
      player: p ? `${p.firstName} ${p.lastName}`.trim() : "Unknown",
      email: p?.email ?? null,
      phone: p?.phone ?? null,
      teamId: e.teamId,
      team: teamName.get(e.teamId) ?? "Team",
      position: pos,
      status: e.status,
      note: e.note,
      addedAt: e.createdAt,
    };
  });
  rows.sort((a, b) => a.team.localeCompare(b.team) || a.position - b.position);
  return rows;
}
