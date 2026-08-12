import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

// TEMPORARY one-time bootstrap/repair endpoint. It runs inside the app, so it
// uses the app's OWN DATABASE_URL — the exact database the login reads — which
// makes it immune to the workflow-vs-app database mismatch we hit while trying
// to create the first production admin. Gated by SETUP_TOKEN.
//
// Diagnostic:  GET /api/bootstrap-admin?token=<SETUP_TOKEN>
// Repair:      GET /api/bootstrap-admin?token=<SETUP_TOKEN>&reset=1
//                  &email=kevin@purepickleball.com&password=<>=8 chars>
//
// REMOVE THIS ROUTE once the production admin can log in.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = process.env.SETUP_TOKEN ?? "";
  if (!expected || url.searchParams.get("token") !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Which database is the app actually talking to? (host only, no credentials)
  const dbHost = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").host;
    } catch {
      return "unparseable";
    }
  })();

  const email = (url.searchParams.get("email") ?? "").toLowerCase().trim();
  const password = url.searchParams.get("password") ?? "";
  let action = "diagnostic-only";

  if (url.searchParams.get("reset") === "1") {
    if (!email || password.length < 8) {
      return NextResponse.json(
        { ok: false, error: "reset needs email and password (>= 8 chars)", dbHost },
        { status: 400 },
      );
    }
    const passwordHash = await hashPassword(password);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          role: "ADMIN",
          extraRoles: [],
          active: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      action = "updated-existing";
    } else {
      const person =
        (await prisma.person.findFirst({ where: { email } })) ??
        (await prisma.person.create({
          data: {
            firstName: (url.searchParams.get("first") ?? "Admin").trim() || "Admin",
            lastName: (url.searchParams.get("last") ?? "User").trim() || "User",
            email,
          },
        }));
      await prisma.user.create({
        data: { email, passwordHash, role: "ADMIN", personId: person.id, active: true },
      });
      action = "created-new";
    }
  }

  const users = await prisma.user.findMany({
    select: { email: true, role: true, active: true, failedLoginCount: true, lockedUntil: true },
  });

  return NextResponse.json({ ok: true, dbHost, action, totalUsers: users.length, users });
}
