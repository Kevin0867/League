import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { Role } from "@/lib/enums";

// Staff/coach account creation as a native-form-POST route handler with ticket
// auth. Route handlers 303-redirect to a fresh GET (which carries the session
// cookie), so unlike a server action they don't re-render inline under the
// cookieless POST and bounce through the console layout's auth.
export const dynamic = "force-dynamic";

const CREATABLE_ROLES: Role[] = ["DIRECTOR", "CEO", "COACH"];

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/coaches${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  const op = String(formData.get("op") ?? "");

  switch (op) {
    case "create": {
      if (!actor || !["COO", "DIRECTOR"].includes(actor.role)) return back("?err=auth");

      const firstName = String(formData.get("firstName") ?? "").trim();
      const lastName = String(formData.get("lastName") ?? "").trim();
      const email = String(formData.get("email") ?? "").toLowerCase().trim();
      const role = String(formData.get("role") ?? "COACH") as Role;
      const password = String(formData.get("password") ?? "");

      if (!firstName || !lastName || !email || !password) return back("?err=fields");
      if (password.length < 8) return back("?err=short");
      if (!CREATABLE_ROLES.includes(role)) return back("?err=role");
      // Only a COO may mint admin-level roles; a Director can create coaches.
      if (role !== "COACH" && actor.role !== "COO") return back("?err=role");

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return back("?err=exists");

      // Reuse a Person with this email (e.g. a coach who also registered) if present.
      const person =
        (await prisma.person.findFirst({ where: { email } })) ??
        (await prisma.person.create({ data: { firstName, lastName, email } }));

      const user = await prisma.user.create({
        data: { email, passwordHash: await hashPassword(password), role, personId: person.id },
      });

      // A coach account needs a Coach profile row so they appear on the Coaches
      // page and can fill out certification/availability.
      if (role === "COACH") {
        const existingCoach = await prisma.coach.findUnique({ where: { personId: person.id } });
        if (!existingCoach) await prisma.coach.create({ data: { personId: person.id } });
      }

      await audit({
        actorId: actor.userId,
        entityType: "User",
        entityId: user.id,
        action: "user.create",
        summary: `Created ${role} account for ${email}`,
      });

      return back("?ok=1");
    }
    default:
      return back("?err=op");
  }
}
