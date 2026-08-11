import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm, hashPassword } from "@/lib/auth";
import { can, isStaff } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { createResetToken, INVITE_TTL_MS } from "@/lib/passwordReset";
import { sendConsoleInvite } from "@/lib/domain/inviteEmail";
import { appUrl } from "@/lib/stripe";
import type { Role } from "@/lib/enums";

// Staff/coach account creation as a native-form-POST route handler with ticket
// auth. Route handlers 303-redirect to a fresh GET (which carries the session
// cookie), so unlike a server action they don't re-render inline under the
// cookieless POST and bounce through the console layout's auth.
export const dynamic = "force-dynamic";

const CREATABLE_ROLES: Role[] = ["ADMIN", "COACH"];

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const rawReturn = String(formData.get("returnTo") ?? "");
  const returnBase = rawReturn.startsWith("/console/coaches") ? rawReturn : "/console/coaches";
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`${returnBase}${qs}`, origin), 303);

  const actor = await actorFromForm(formData);
  const op = String(formData.get("op") ?? "");

  switch (op) {
    // Show/hide a coach on the public /coaches page.
    case "togglePublish": {
      if (!actor || !can(actor.role, "manageCoaches")) return back("?err=auth");
      const personId = String(formData.get("personId") ?? "");
      const coach = await prisma.coach.findUnique({ where: { personId } });
      if (!coach) return back("?err=notfound");
      await prisma.coach.update({ where: { id: coach.id }, data: { publishedOnSite: !coach.publishedOnSite } });
      await audit({ actorId: actor.userId, entityType: "Coach", entityId: coach.id, action: "coach.publishToggle", summary: coach.publishedOnSite ? "Unpublished from /coaches" : "Published to /coaches" });
      return back("?ok=publish");
    }

    case "create": {
      if (!actor || !can(actor.role, "manageCoaches")) return back("?err=auth");

      const firstName = String(formData.get("firstName") ?? "").trim();
      const lastName = String(formData.get("lastName") ?? "").trim();
      const email = String(formData.get("email") ?? "").toLowerCase().trim();
      const role = String(formData.get("role") ?? "COACH") as Role;
      const password = String(formData.get("password") ?? "");

      if (!CREATABLE_ROLES.includes(role)) return back("?err=role");

      // If an account already exists for this email, don't dead-end — link a
      // Coach profile onto that existing person so they show up in the coaching
      // area. We never touch their password and never downgrade a staff role.
      const existingUser = await prisma.user.findUnique({ where: { email }, include: { person: true } });
      if (existingUser) {
        const person =
          existingUser.person ??
          (await prisma.person.findFirst({ where: { email } })) ??
          (await prisma.person.create({ data: { firstName, lastName, email } }));
        if (!existingUser.personId) {
          await prisma.user.update({ where: { id: existingUser.id }, data: { personId: person.id } });
        }
        const existingCoach = await prisma.coach.findUnique({ where: { personId: person.id } });
        if (!existingCoach) await prisma.coach.create({ data: { personId: person.id } });
        // Only elevate a non-staff account (player/parent) to COACH; leave an
        // existing admin/staff role untouched.
        if (role === "COACH" && !isStaff(existingUser.role as Role)) {
          await prisma.user.update({ where: { id: existingUser.id }, data: { role: "COACH" } });
        }
        await audit({
          actorId: actor.userId,
          entityType: "User",
          entityId: existingUser.id,
          action: "user.linkCoach",
          summary: `Linked a coach profile to existing account ${email}`,
        });
        return NextResponse.redirect(new URL(`/console/coaches/${person.id}?ok=account`, origin), 303);
      }

      // New account path: password required.
      if (!firstName || !lastName || !email || !password) return back("?err=fields");
      if (password.length < 8) return back("?err=short");
      if (password !== String(formData.get("passwordConfirm") ?? "")) return back("?err=mismatch");

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

      // Notify the new account holder: email a set-password / join link so a
      // coach doesn't depend on the admin relaying the temporary password.
      try {
        const token = await createResetToken(user.id, INVITE_TTL_MS);
        const link = `${appUrl()}/reset?token=${encodeURIComponent(token)}&invite=1`;
        await sendConsoleInvite({ toEmail: email, name: firstName, role, link });
        await audit({ actorId: actor.userId, entityType: "User", entityId: user.id, action: "user.invite", summary: `Invite emailed to ${email}` });
      } catch (e) {
        console.error("coach invite email failed", e);
      }

      // For a coach, drop the admin straight onto the full profile form so they
      // can fill in certification, screening, markets, and availability now.
      if (role === "COACH") {
        return NextResponse.redirect(new URL(`/console/coaches/${person.id}?ok=account`, origin), 303);
      }
      return back("?ok=1");
    }
    default:
      return back("?err=op");
  }
}
