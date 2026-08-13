import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm, hashPassword } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { ASSIGNABLE_ROLES, splitRoles, type Role } from "@/lib/enums";
import { audit } from "@/lib/audit";
import { createResetToken, INVITE_TTL_MS } from "@/lib/passwordReset";
import { sendConsoleInvite } from "@/lib/domain/inviteEmail";
import { appUrl } from "@/lib/stripe";
import crypto from "crypto";

// Assign access/roles to existing users (§17). Admins manage users and may grant
// any role (roles are consolidated to Admin/Coach/Player/Parent). Granting COACH
// ensures a Coach profile row exists so the new coach can fill it out.
export const dynamic = "force-dynamic";

const ASSIGNABLE: string[] = ASSIGNABLE_ROLES;

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/users${qs}`, origin), 303);

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "manageUsers")) return back("?err=auth");

  const op = String(fd.get("op") ?? "");

  // Invite a brand-new user — creates the account and emails a set-password link.
  if (op === "invite") {
    const email = String(fd.get("email") ?? "").toLowerCase().trim();
    const firstName = String(fd.get("firstName") ?? "").trim();
    const lastName = String(fd.get("lastName") ?? "").trim();
    const role = String(fd.get("role") ?? "").trim();
    if (!email || !firstName || !lastName || !ASSIGNABLE.includes(role)) return back("?err=fields");
    if (await prisma.user.findUnique({ where: { email } })) return back("?err=exists");

    const person =
      (await prisma.person.findFirst({ where: { email } })) ??
      (await prisma.person.create({ data: { firstName, lastName, email } }));
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(crypto.randomBytes(24).toString("hex")),
        role,
        personId: person.id,
        active: true,
      },
    });
    if (role === "COACH" && !(await prisma.coach.findUnique({ where: { personId: person.id } }))) {
      await prisma.coach.create({ data: { personId: person.id } });
    }
    const token = await createResetToken(user.id, INVITE_TTL_MS);
    const link = `${appUrl()}/reset?token=${encodeURIComponent(token)}&invite=1`;
    const sent = await sendConsoleInvite({ toEmail: email, name: firstName, role, link });
    await audit({
      actorId: actor.userId,
      entityType: "User",
      entityId: user.id,
      action: "user.invite",
      summary: `Invited ${email} as ${role}${sent.ok ? (sent.simulated ? " (email simulated — not configured)" : "") : ` (email FAILED: ${sent.error ?? "unknown"})`}`,
    });
    // Surface delivery problems instead of silently claiming success — the
    // account exists either way, but the admin needs to know the email didn't go.
    if (!sent.ok) return back("?err=invite-send");
    if (sent.simulated) return back("?ok=invited-sim");
    return back("?ok=invited");
  }

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

      await prisma.user.update({ where: { id: userId }, data: { role, extraRoles: [] } });

      // Granting COACH: make sure a Coach profile exists to fill out.
      if (role === "COACH" && target.personId) {
        const existing = await prisma.coach.findUnique({ where: { personId: target.personId } });
        if (!existing) await prisma.coach.create({ data: { personId: target.personId } });
      }
      await audit({ actorId: actor.userId, entityType: "User", entityId: userId, action: "user.setRole", summary: `Role → ${role}` });
      return back("?ok=role");
    }

    // Multi-role: assign a set of roles at once (an admin who also coaches, a
    // parent who also coaches, …). Access is the union; the highest-priority
    // role becomes the primary.
    case "setRoles": {
      const chosen = fd.getAll("roles").map(String).filter((r) => ASSIGNABLE.includes(r)) as Role[];
      if (chosen.length === 0) return back("?err=role");
      const { role, extraRoles } = splitRoles(chosen);

      await prisma.user.update({ where: { id: userId }, data: { role, extraRoles } });

      // Any set that includes COACH needs a Coach profile to fill out.
      if (chosen.includes("COACH") && target.personId) {
        const existing = await prisma.coach.findUnique({ where: { personId: target.personId } });
        if (!existing) await prisma.coach.create({ data: { personId: target.personId } });
      }
      await audit({ actorId: actor.userId, entityType: "User", entityId: userId, action: "user.setRoles", summary: `Roles → ${chosen.join(", ")}` });
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
