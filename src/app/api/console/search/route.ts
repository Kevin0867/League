import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";
import { personSearchOR } from "@/lib/domain/personSearch";

// Lightweight global search for the console command palette. GET (the session
// cookie IS delivered on GETs in this runtime), staff-only, capped results.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !isStaff(session.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const contains = { contains: q, mode: "insensitive" as const };
  const personSelect = { id: true, firstName: true, lastName: true, email: true, coach: { select: { id: true } } } as const;

  const [people, byAccount, teams, facilities, sponsors] = await Promise.all([
    // People across every name + contact field (including secondary emails).
    prisma.person.findMany({ where: { OR: personSearchOR(q) }, select: personSelect, take: 10, orderBy: { lastName: "asc" } }),
    // Accounts whose LOGIN email matches — surfaces a person even when their
    // account email differs from the contact email on their record.
    prisma.user.findMany({ where: { email: contains, personId: { not: null } }, select: { person: { select: personSelect } }, take: 8 }),
    prisma.team.findMany({ where: { OR: [{ name: contains }, { market: contains }, { divisionCode: contains }] }, select: { id: true, name: true, market: true }, take: 6, orderBy: { name: "asc" } }),
    prisma.facility.findMany({ where: { OR: [{ name: contains }, { market: contains }], archived: false }, select: { id: true, name: true, market: true }, take: 6, orderBy: { name: "asc" } }),
    prisma.sponsor.findMany({ where: { OR: [{ name: contains }, { contactName: contains }, { email: contains }] }, select: { id: true, name: true, contactName: true }, take: 6, orderBy: { name: "asc" } }),
  ]);

  // Merge account-matched people into the people list, de-duplicated by id.
  const seen = new Set(people.map((p) => p.id));
  const merged = [...people];
  for (const u of byAccount) {
    if (u.person && !seen.has(u.person.id)) {
      seen.add(u.person.id);
      merged.push(u.person);
    }
  }

  const results = [
    ...merged.map((p) => ({
      type: p.coach ? "Coach" : "Person",
      label: `${p.firstName} ${p.lastName}`,
      sublabel: p.email ?? "",
      href: p.coach ? `/console/coaches/${p.id}` : `/console/people/${p.id}`,
    })),
    ...teams.map((t) => ({ type: "Team", label: t.name, sublabel: t.market ?? "", href: `/console/teams/${t.id}` })),
    ...facilities.map((f) => ({ type: "Facility", label: f.name, sublabel: f.market ?? "", href: `/console/facilities` })),
    ...sponsors.map((s) => ({ type: "Sponsor", label: s.name, sublabel: s.contactName ?? "", href: `/console/sponsorships#sponsors` })),
  ];

  return NextResponse.json({ results });
}
