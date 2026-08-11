import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";

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

  const [people, teams, facilities] = await Promise.all([
    prisma.person.findMany({
      where: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }] },
      select: { id: true, firstName: true, lastName: true, email: true, coach: { select: { id: true } } },
      take: 8,
      orderBy: { lastName: "asc" },
    }),
    prisma.team.findMany({ where: { name: contains }, select: { id: true, name: true, market: true }, take: 6, orderBy: { name: "asc" } }),
    prisma.facility.findMany({ where: { name: contains, archived: false }, select: { id: true, name: true, market: true }, take: 6, orderBy: { name: "asc" } }),
  ]);

  const results = [
    ...people.map((p) => ({
      type: p.coach ? "Coach" : "Person",
      label: `${p.firstName} ${p.lastName}`,
      sublabel: p.email ?? "",
      href: p.coach ? `/console/coaches/${p.id}` : `/console/people/${p.id}`,
    })),
    ...teams.map((t) => ({ type: "Team", label: t.name, sublabel: t.market ?? "", href: `/console/teams/${t.id}` })),
    ...facilities.map((f) => ({ type: "Facility", label: f.name, sublabel: f.market ?? "", href: `/console/facilities` })),
  ];

  return NextResponse.json({ results });
}
