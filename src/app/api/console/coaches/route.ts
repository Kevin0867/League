import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { actorFromForm, hashPassword } from "@/lib/auth";
import { can, isStaff } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { createResetToken, INVITE_TTL_MS } from "@/lib/passwordReset";
import { sendConsoleInvite } from "@/lib/domain/inviteEmail";
import { appUrl } from "@/lib/stripe";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";
import { waiverRequestEmail } from "@/lib/email/waiverRequestEmail";
import { dispatchMessage } from "@/lib/messaging";
import type { Role } from "@/lib/enums";
import { effectiveRoles, splitRoles } from "@/lib/enums";

// Staff/coach account creation as a native-form-POST route handler with ticket
// auth. Route handlers 303-redirect to a fresh GET (which carries the session
// cookie), so unlike a server action they don't re-render inline under the
// cookieless POST and bounce through the console layout's auth.
export const dynamic = "force-dynamic";

const CREATABLE_ROLES: Role[] = ["ADMIN", "COACH"];

// Mint a set-password link for a user, try to email it, and report back the
// token + whether it actually sent + any send error. Shared by create, link,
// and the explicit "Send invite" action so all three behave identically.
async function issueInvite(user: { id: string; email: string }, name: string, role: string) {
  const token = await createResetToken(user.id, INVITE_TTL_MS);
  const link = `${appUrl()}/reset?token=${encodeURIComponent(token)}&invite=1`;
  let sent = false;
  let error = "";
  try {
    const res = await sendConsoleInvite({ toEmail: user.email, name, role, link });
    sent = res.ok && !res.simulated;
    if (!res.ok && res.error) error = res.error;
  } catch (e) {
    error = e instanceof Error ? e.message : "send failed";
    console.error("coach invite email failed", e);
  }
  return { token, sent, error };
}

// Build the redirect query that carries the invite result to the coach page.
function inviteQuery(base: Record<string, string>, r: { token: string; sent: boolean; error: string }) {
  const qs = new URLSearchParams(base);
  qs.set("invitetoken", r.token);
  if (r.sent) qs.set("invitesent", "1");
  if (r.error) qs.set("inviteerr", r.error.slice(0, 180));
  return qs.toString();
}

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
    // Send a coach their participation waiver — a tokenized, no-login link to
    // the same /waiver/sign flow players use. Coaches sign for themselves (adult,
    // no parental consent). Recorded on their Person like any other waiver.
    case "sendWaiver": {
      if (!actor || !can(actor.role, "manageCoaches")) return back("?err=auth");
      const personId = String(formData.get("personId") ?? "");
      const person = await prisma.person.findUnique({
        where: { id: personId },
        select: { id: true, firstName: true, isMinor: true },
      });
      if (!person) return back("?err=notfound");
      const token = await signWaiverToken(person.id);
      const link = `${appUrl()}/waiver/sign?token=${encodeURIComponent(token)}`;
      const email = waiverRequestEmail({ name: person.firstName, link, isMinor: person.isMinor });
      await dispatchMessage({
        senderId: actor.userId,
        seasonId: null,
        audienceType: "SINGLE_PERSON",
        audienceRef: person.id,
        channels: ["IN_APP", "EMAIL"],
        triggerType: "WAIVER_REQUEST",
        subject: email.subject,
        body: email.text,
        html: email.html,
      });
      await audit({ actorId: actor.userId, entityType: "Person", entityId: person.id, action: "WAIVER_REQUESTED", summary: "Coach waiver request sent" });
      return back("?ok=waiverSent");
    }

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

    // Publish (or hide) every coach profile on the public site at once.
    case "publishAll":
    case "hideAll": {
      if (!actor || !can(actor.role, "manageCoaches")) return back("?err=auth");
      const publish = op === "publishAll";
      const res = await prisma.coach.updateMany({ data: { publishedOnSite: publish } });
      await audit({ actorId: actor.userId, entityType: "Coach", entityId: "all", action: "coach.publishAll", summary: `${publish ? "Published" : "Hid"} ${res.count} coach profile(s) on /coaches` });
      return back("?ok=publish");
    }

    // (Re)send a console invite — mints a fresh set-password link, tries to
    // email it, and ALWAYS returns the link so the admin can copy/share it even
    // when email delivery isn't configured (Resend key unset → simulated send).
    case "invite": {
      if (!actor || !can(actor.role, "manageCoaches")) return back("?err=auth");
      const personId = String(formData.get("personId") ?? "");
      const user = await prisma.user.findFirst({ where: { personId }, include: { person: true } });
      if (!user) return back("?err=nouser");
      const inv = await issueInvite(user, user.person?.firstName ?? user.email, user.role);
      await audit({ actorId: actor.userId, entityType: "User", entityId: user.id, action: "user.invite", summary: inv.sent ? `Invite emailed to ${user.email}` : `Invite link generated for ${user.email}${inv.error ? ` (send failed: ${inv.error})` : " (email not delivered)"}` });
      return back(`?${inviteQuery({}, inv)}`);
    }

    case "create": {
      if (!actor || !can(actor.role, "manageCoaches")) return back("?err=auth");

      const firstName = String(formData.get("firstName") ?? "").trim();
      const lastName = String(formData.get("lastName") ?? "").trim();
      const email = String(formData.get("email") ?? "").toLowerCase().trim();
      const role = String(formData.get("role") ?? "COACH") as Role;

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
        // Auto-issue an invite so the admin gets the set-password link right
        // away (and it's emailed when delivery is configured) — no separate
        // "Send invite" click needed.
        const inv = await issueInvite(existingUser, existingUser.person?.firstName ?? (firstName || email), "COACH");
        return NextResponse.redirect(new URL(`/console/coaches/${person.id}?${inviteQuery({ ok: "account" }, inv)}`, origin), 303);
      }

      // New account path — no admin-typed password. The person sets their own
      // via the emailed invite link (same as the Access invite flow), so we
      // create the account with an unusable random hash until they do.
      if (!firstName || !lastName || !email) return back("?err=fields");

      // Reuse a Person with this email (e.g. a coach who also registered) if present.
      const person =
        (await prisma.person.findFirst({ where: { email } })) ??
        (await prisma.person.create({ data: { firstName, lastName, email } }));

      const user = await prisma.user.create({
        data: { email, passwordHash: await hashPassword(crypto.randomBytes(24).toString("hex")), role, personId: person.id },
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

      // Email the new account holder a set-password link, and capture whether it
      // actually went out so the admin can copy it if delivery fails.
      const inv = await issueInvite(user, firstName, role);
      await audit({ actorId: actor.userId, entityType: "User", entityId: user.id, action: "user.invite", summary: inv.sent ? `Invite emailed to ${email}` : `Invite link generated for ${email}${inv.error ? ` (send failed: ${inv.error})` : " (email not delivered)"}` });

      // For a coach, drop the admin straight onto the full profile form so they
      // can fill in certification, screening, markets, and availability now.
      if (role === "COACH") {
        return NextResponse.redirect(new URL(`/console/coaches/${person.id}?${inviteQuery({ ok: "account" }, inv)}`, origin), 303);
      }
      return back("?ok=1");
    }
    // Add a coach with their full details, WITHOUT necessarily inviting them.
    // Creates the Person + Coach profile directly (name, contact, credentials,
    // levels, bio, screening). A login/invite is optional — only when the admin
    // ticks "create a login". Lands on the profile to add availability/photo.
    case "createFull": {
      if (!actor || !can(actor.role, "manageCoaches")) return back("?err=auth");
      const firstName = String(formData.get("firstName") ?? "").trim();
      const lastName = String(formData.get("lastName") ?? "").trim();
      if (!firstName || !lastName) return back("?err=fields");
      const email = String(formData.get("email") ?? "").toLowerCase().trim() || null;
      const phone = String(formData.get("phone") ?? "").trim() || null;
      const address = String(formData.get("address") ?? "").trim() || null;
      const certifications = String(formData.get("certifications") ?? "").trim() || null;
      const rpoCertLevel = String(formData.get("rpoCertLevel") ?? "").trim() || null;
      const coachingLevels = String(formData.get("coachingLevels") ?? "").trim() || null;
      const bio = String(formData.get("bio") ?? "").trim() || null;
      const bgCompany = String(formData.get("backgroundCheckCompany") ?? "").trim() || null;
      const bgDateRaw = String(formData.get("backgroundCheckDate") ?? "").trim();
      const backgroundCheckDate = bgDateRaw ? new Date(bgDateRaw) : null;
      const sendInvite = String(formData.get("sendInvite") ?? "") === "on";

      // Reuse a Person with this email if present; otherwise create fresh. An
      // email-less coach is fine — they just have no login until one's added.
      const person =
        (email ? await prisma.person.findFirst({ where: { email } }) : null) ??
        (await prisma.person.create({ data: { firstName, lastName, email, phone, address } }));
      // If we matched an existing person, fill in any contact fields provided.
      if (person.firstName !== firstName || person.lastName !== lastName || phone || address) {
        await prisma.person.update({
          where: { id: person.id },
          data: {
            firstName: person.firstName || firstName,
            lastName: person.lastName || lastName,
            phone: phone ?? person.phone,
            address: address ?? person.address,
          },
        });
      }

      const coachData = { certifications, rpoCertLevel, coachingLevels, bio, backgroundCheckCompany: bgCompany, backgroundCheckDate };
      const existingCoach = await prisma.coach.findUnique({ where: { personId: person.id } });
      await (existingCoach
        ? prisma.coach.update({ where: { id: existingCoach.id }, data: coachData })
        : prisma.coach.create({ data: { personId: person.id, ...coachData } }));

      await audit({ actorId: actor.userId, entityType: "Person", entityId: person.id, action: "coach.createFull", summary: `Added coach ${firstName} ${lastName}${email ? ` (${email})` : " (no email)"}${sendInvite ? " + invite" : ""}` });

      // Optional login + invite — only when asked, and only if we have an email.
      if (sendInvite && email) {
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(crypto.randomBytes(24).toString("hex")), role: "COACH", personId: person.id } });
        } else if (!user.personId) {
          await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
        }
        const inv = await issueInvite(user, firstName, "COACH");
        return NextResponse.redirect(new URL(`/console/coaches/${person.id}?${inviteQuery({ ok: "account" }, inv)}`, origin), 303);
      }

      return NextResponse.redirect(new URL(`/console/coaches/${person.id}?ok=added`, origin), 303);
    }

    // Remove a coach: strip their coaching role and delete the Coach profile.
    // The person and their login are KEPT (they may also be a parent/player) —
    // we just unassign them from everything coach-related and drop the COACH
    // role. If COACH was their only role the login is neutralized to PLAYER, so
    // it stays valid but no longer appears as a coach.
    case "removeCoach": {
      if (!actor || !can(actor.role, "manageCoaches")) return back("?err=auth");
      const personId = String(formData.get("personId") ?? "");
      const person = await prisma.person.findUnique({
        where: { id: personId },
        select: { id: true, firstName: true, lastName: true, coach: { select: { id: true } } },
      });
      if (!person) return back("?err=notfound");
      const coachId = person.coach?.id ?? null;
      const user = await prisma.user.findFirst({ where: { personId }, select: { id: true, role: true, extraRoles: true } });

      try {
        await prisma.$transaction(async (tx) => {
          if (coachId) {
            // Detach every reference to this coach before deleting the profile.
            await tx.team.updateMany({ where: { coachId }, data: { coachId: null } });
            await tx.teamCoach.deleteMany({ where: { coachId } });
            await tx.sessionCoach.deleteMany({ where: { coachId } });
            await tx.alaCarteBooking.updateMany({ where: { coachId }, data: { coachId: null } });
            await tx.alaCarteOffering.updateMany({ where: { coachId }, data: { coachId: null } });
            await tx.coachPayoutLine.deleteMany({ where: { coachId } });
            await tx.registration.updateMany({ where: { recruitedByCoachId: coachId }, data: { recruitedByCoachId: null } });
            await tx.person.updateMany({ where: { recruitedByCoachId: coachId }, data: { recruitedByCoachId: null } });
            await tx.coach.delete({ where: { id: coachId } }); // availability blocks cascade
          }
          if (user) {
            const roles = effectiveRoles(user).filter((r) => r !== "COACH");
            if (roles.length === 0) {
              await tx.user.update({ where: { id: user.id }, data: { role: "PLAYER", extraRoles: [] } });
            } else {
              const split = splitRoles(roles);
              await tx.user.update({ where: { id: user.id }, data: { role: split.role, extraRoles: split.extraRoles } });
            }
          }
        });
      } catch (e) {
        console.error("removeCoach failed", e);
        return back("?err=removefail");
      }

      await audit({ actorId: actor.userId, entityType: "Coach", entityId: coachId ?? personId, action: "coach.remove", summary: `Removed coach ${person.firstName} ${person.lastName}` });
      return back("?ok=removed");
    }
    default:
      return back("?err=op");
  }
}
