import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm, hashPassword } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { ASSIGNABLE_ROLES, ADMIN_ROLES, splitRoles, type Role } from "@/lib/enums";
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

  // Bulk role assignment from the Access page — every changed row's role set in
  // one POST, so an admin edits several people's roles and saves once. Applied
  // sequentially with a per-change last-admin guard against current DB state.
  if (op === "setRolesBulk") {
    let changes: { userId: string; roles: string[] }[] = [];
    try {
      const parsed = JSON.parse(String(fd.get("changes") ?? "[]"));
      if (Array.isArray(parsed)) {
        changes = parsed
          .map((c) => ({ userId: String(c?.userId ?? ""), roles: Array.isArray(c?.roles) ? c.roles.map(String) : [] }))
          .filter((c) => c.userId);
      }
    } catch {
      return back("?err=fields");
    }
    let applied = 0;
    const skipped: string[] = [];
    for (const ch of changes) {
      const chosen = ch.roles.filter((r) => ASSIGNABLE.includes(r)) as Role[];
      if (chosen.length === 0) { skipped.push(ch.userId); continue; }
      const t = await prisma.user.findUnique({ where: { id: ch.userId }, select: { id: true, role: true, extraRoles: true, personId: true } });
      if (!t) { skipped.push(ch.userId); continue; }
      // Don't let a batch strip the last admin.
      if (!chosen.includes("ADMIN" as Role)) {
        const targetIsAdmin = [t.role, ...t.extraRoles].some((r) => ADMIN_ROLES.includes(r as never));
        if (targetIsAdmin) {
          const all = await prisma.user.findMany({ where: { active: true }, select: { id: true, role: true, extraRoles: true } });
          const admins = all.filter((a) => [a.role, ...a.extraRoles].some((r) => ADMIN_ROLES.includes(r as never)));
          if (admins.length <= 1) { skipped.push(ch.userId); continue; }
        }
      }
      const { role, extraRoles } = splitRoles(chosen);
      await prisma.user.update({ where: { id: ch.userId }, data: { role, extraRoles } });
      if (chosen.includes("COACH") && t.personId) {
        const existing = await prisma.coach.findUnique({ where: { personId: t.personId } });
        if (!existing) await prisma.coach.create({ data: { personId: t.personId } });
      }
      await audit({ actorId: actor.userId, entityType: "User", entityId: ch.userId, action: "user.setRoles", summary: `Roles → ${chosen.join(", ")} (bulk)` });
      applied++;
    }
    const qs = new URLSearchParams({ ok: "rolesBulk", n: String(applied) });
    if (skipped.length) qs.set("skipped", String(skipped.length));
    return back(`?${qs.toString()}`);
  }

  const userId = String(fd.get("userId") ?? "");
  if (!userId) return back("?err=fields");

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, extraRoles: true, personId: true } });
  if (!target) return back("?err=notfound");
  const isSelf = target.id === actor.userId;

  // Would removing admin from this target leave the org with zero admins? Used to
  // guard role changes — admins may adjust anyone's access (including their own),
  // but not strip the last admin and lock everyone out.
  async function wouldOrphanAdmins(keepsAdmin: boolean): Promise<boolean> {
    if (keepsAdmin) return false;
    const targetIsAdmin = [target!.role, ...target!.extraRoles].some((r) => ADMIN_ROLES.includes(r as never));
    if (!targetIsAdmin) return false;
    const all = await prisma.user.findMany({ where: { active: true }, select: { id: true, role: true, extraRoles: true } });
    const admins = all.filter((a) => [a.role, ...a.extraRoles].some((r) => ADMIN_ROLES.includes(r as never)));
    return admins.length <= 1;
  }

  switch (op) {
    case "setRole": {
      const role = String(fd.get("role") ?? "");
      if (!ASSIGNABLE.includes(role)) return back("?err=role");
      if (await wouldOrphanAdmins(role === "ADMIN")) return back("?err=lastadmin");

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
      if (await wouldOrphanAdmins(chosen.includes("ADMIN" as Role))) return back("?err=lastadmin");
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
      // Don't let someone disable their own login out from under themselves.
      if (isSelf && !active) return back("?err=self");
      await prisma.user.update({ where: { id: userId }, data: { active } });
      await audit({ actorId: actor.userId, entityType: "User", entityId: userId, action: "user.toggleActive", summary: active ? "Enabled" : "Disabled" });
      return back("?ok=active");
    }

    // Re-send the set-password invite to an existing account (e.g. one whose
    // first invite bounced or was never delivered). Mints a fresh 7-day link
    // and reports the actual delivery result, like the original invite.
    case "resendInvite": {
      const u = await prisma.user.findUnique({ where: { id: userId }, include: { person: true } });
      if (!u) return back("?err=notfound");
      const token = await createResetToken(u.id, INVITE_TTL_MS);
      const link = `${appUrl()}/reset?token=${encodeURIComponent(token)}&invite=1`;
      const sent = await sendConsoleInvite({ toEmail: u.email, name: u.person?.firstName ?? "there", role: u.role, link });
      await audit({
        actorId: actor.userId,
        entityType: "User",
        entityId: u.id,
        action: "user.resendInvite",
        summary: `Re-sent invite to ${u.email}${sent.ok ? (sent.simulated ? " (simulated)" : "") : ` (FAILED: ${sent.error ?? "unknown"})`}`,
      });
      if (!sent.ok) return back("?err=invite-send");
      if (sent.simulated) return back("?ok=invited-sim");
      return back("?ok=invite-resent");
    }

    // Edit a user's identity — name, login email, phone. Updates the login
    // email and the linked Person (creating/linking one if this login had none).
    case "editUser": {
      const firstName = String(fd.get("firstName") ?? "").trim();
      const lastName = String(fd.get("lastName") ?? "").trim();
      const email = String(fd.get("email") ?? "").toLowerCase().trim();
      const phone = String(fd.get("phone") ?? "").trim() || null;
      if (!firstName || !lastName || !email) return back("?err=fields");
      // Login email must stay unique.
      const clash = await prisma.user.findFirst({ where: { email, id: { not: userId } }, select: { id: true } });
      if (clash) return back("?err=exists");

      if (target.personId) {
        await prisma.person.update({ where: { id: target.personId }, data: { firstName, lastName, email, phone } });
      } else {
        const person = await prisma.person.create({ data: { firstName, lastName, email, phone } });
        await prisma.user.update({ where: { id: userId }, data: { personId: person.id } });
      }
      await prisma.user.update({ where: { id: userId }, data: { email } });
      await audit({ actorId: actor.userId, entityType: "User", entityId: userId, action: "user.edit", summary: `Edited login ${email}` });
      return back("?ok=edited");
    }

    // Generate a set-password link WITHOUT emailing it — the admin copies it and
    // delivers it however they like (text, in person). Handy when email delivery
    // is unreliable. The link is shown once, in a copy box, on return.
    case "inviteLink": {
      const token = await createResetToken(userId, INVITE_TTL_MS);
      const link = `${appUrl()}/reset?token=${encodeURIComponent(token)}&invite=1`;
      await audit({ actorId: actor.userId, entityType: "User", entityId: userId, action: "user.inviteLink", summary: "Generated set-password link" });
      return back(`?link=${encodeURIComponent(link)}&linkFor=${userId}`);
    }

    // Delete a login account. Keeps the person's records (registrations, team
    // memberships, coach profile) — only the sign-in is removed. Guarded so the
    // org can't delete its last admin and lock everyone out (self is already
    // blocked above).
    case "deleteUser": {
      if (isSelf) return back("?err=self");
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, extraRoles: true, email: true } });
      if (!u) return back("?err=notfound");
      const targetIsAdmin = [u.role, ...u.extraRoles].some((r) => ADMIN_ROLES.includes(r as never));
      if (targetIsAdmin) {
        const all = await prisma.user.findMany({ where: { active: true }, select: { role: true, extraRoles: true } });
        const admins = all.filter((a) => [a.role, ...a.extraRoles].some((r) => ADMIN_ROLES.includes(r as never)));
        if (admins.length <= 1) return back("?err=lastadmin");
      }
      try {
        await prisma.user.delete({ where: { id: userId } });
      } catch {
        return back("?err=delete");
      }
      await audit({ actorId: actor.userId, entityType: "User", entityId: userId, action: "user.delete", summary: `Deleted login ${u.email}` });
      return back("?ok=deleted");
    }

    default:
      return back("?err=op");
  }
}
