import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isStaff } from "@/lib/rbac";
import { personSearchOR } from "@/lib/domain/personSearch";

// Focused people lookup for pickers (e.g. attaching an imported payment to a
// family). GET — the session cookie IS delivered on GETs here — staff-only.
// Returns just {id, name, email} so the caller can bind a personId.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !isStaff(session.roles ?? [session.role])) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ people: [] });

  const people = await prisma.person.findMany({
    where: { OR: personSearchOR(q) },
    select: { id: true, firstName: true, lastName: true, email: true },
    take: 12,
    orderBy: { lastName: "asc" },
  });

  return NextResponse.json({
    people: people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, email: p.email ?? null })),
  });
}
