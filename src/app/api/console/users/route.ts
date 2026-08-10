import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { ADMIN_ROLES, ROLE_LABELS } from "@/lib/enums";
import { audit } from "@/lib/audit";

// Assign access/roles to existing users (§17). COO/DIRECTOR may manage users;
// only the COO may grant admin roles (COO/CEO/DIRECTOR). Granting COACH ensures
// a Coach profile row exists so the new coach can fill it out.
export const dynamic = "force-dynamic";

const ASSIGNABLE = Object.keys(ROLE_LABELS);

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/users${qs}`, origin), 303);

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "manageUsers")) return back("?err=auth");

  const op = String(fd.get("op") ?? "");
  const userId = String(fd.get("userId") ?? "");
  if (!userId) return back("?err=fields");

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, personId: true } });
  if (!target) return back("?err=notfound");
  // Never let someone change their own access (avoid self-lockout).
  if (target.id === actor.userId) return back("?err=self");

  switch (op) {
    case "setRole": {
      const role = String(fd.get("role") ?? "");
      if (!ASSIGNABLE.includes(role)) return back("?err=role");
      // Only the COO may grant or revoke admin roles.
      const touchesAdmin = ADMIN_ROLES.includes(role as never) || ADMIN_ROLES.includes(target.role as never);
      if (touchesAdmin && actor.role !== "COO") return back("?err=role");

      await prisma.user.update({ where: { id: userId }, data: { role } });

      // Granting COACH: make sure a Coach profile exists to fill out.
      if (role === "COACH" && target.personId) {
        const existing = await prisma.coach.findUnique({ where: { personId: target.personId } });
        if (!existing) await prisma.coach.create({ data: { personId: target.personId } });
      }
      await audit({ actorId: actor.userId, entityType: "User", entityId: userId, action: "user.setRole", summary: `Role → ${role}` });
      return back("?ok=role");
    }

    case "toggleActive": {
      const active = String(fd.get("active") ?? "") === "true";
      await prisma.user.update({ where: { id: userId }, data: { active } });
      await audit({ actorId: actor.userId, entityType: "User", entityId: userId, action: "user.toggleActive", summary: active ? "Enabled" : "Disabled" });
      return back("?ok=active");
    }

    default:
      return back("?err=op");
  }
}
