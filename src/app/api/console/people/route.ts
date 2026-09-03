import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { encryptField } from "@/lib/crypto";
import { ageFromDob } from "@/lib/domain/messaging-acl";

// Person operations. Currently: merge a duplicate person record into a
// surviving one, moving every reference (registrations, teams, payments,
// waivers, attendance, availability, messages, notes, guardianship, login) so
// counts stop double-reporting. Runs in one transaction — if any reference is
// missed the final delete fails and the whole merge rolls back, so a bad merge
// can never leave the data half-moved.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const returnToRaw = String((await req.clone().formData()).get("returnTo") ?? "").trim();
  const back = (qs: string) => {
    const base = returnToRaw.startsWith("/") && !returnToRaw.startsWith("//") ? returnToRaw : "/console/registrations";
    return NextResponse.redirect(new URL(`${base}${qs}`, origin), 303);
  };

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "managePlayers")) return back("?err=auth");

  const op = String(formData.get("op") ?? "");

  // Admin edit of a person's record — name (coaches included), contact, DOB, and
  // the protected emergency/medical fields (re-encrypted on save). Gated by
  // managePlayers, same as viewing this profile.
  if (op === "editPerson") {
    const g = (k: string) => String(formData.get(k) ?? "").trim();
    const personId = g("personId");
    const firstName = g("firstName");
    const lastName = g("lastName");
    if (!personId || !firstName || !lastName) return back("?err=fields");
    const dobStr = g("dob");
    const dob = dobStr ? new Date(dobStr) : null;
    const age = dob && !isNaN(dob.getTime()) ? ageFromDob(dob) : null;
    await prisma.person.update({
      where: { id: personId },
      data: {
        firstName,
        lastName,
        email: g("email").toLowerCase() || null,
        phone: g("phone") || null,
        dob: dob && !isNaN(dob.getTime()) ? dob : null,
        // Keep the minor flag in step with the birthdate when one is set.
        ...(age !== null ? { isMinor: age < 18 } : {}),
        emergencyName: encryptField(g("emergencyName") || null),
        emergencyPhone: encryptField(g("emergencyPhone") || null),
        emergencyRelation: encryptField(g("emergencyRelation") || null),
        medicalNotes: encryptField(g("medicalNotes") || null),
      },
    });
    await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "person.edit", summary: `Edited ${firstName} ${lastName}` });
    return back("?ok=personedit");
  }

  if (op !== "mergePeople") return back("?err=op");

  const survivorId = String(formData.get("survivorId") ?? "");
  const loserId = String(formData.get("loserId") ?? "");
  if (!survivorId || !loserId || survivorId === loserId) return back("?err=pickpair");

  const [survivor, loser] = await Promise.all([
    prisma.person.findUnique({ where: { id: survivorId } }),
    prisma.person.findUnique({ where: { id: loserId } }),
  ]);
  if (!survivor || !loser) return back("?err=notfound");

  // A coach record can't be safely folded into a player — bail rather than risk it.
  const [survivorCoach, loserCoach] = await Promise.all([
    prisma.coach.findUnique({ where: { personId: survivorId }, select: { id: true } }),
    prisma.coach.findUnique({ where: { personId: loserId }, select: { id: true } }),
  ]);
  if (loserCoach || survivorCoach) return back("?err=coachmerge");

  try {
    await prisma.$transaction(async (tx) => {
      // Simple reassignments — no unique constraint on (person, …).
      await tx.registration.updateMany({ where: { personId: loserId }, data: { personId: survivorId } });
      await tx.waiver.updateMany({ where: { personId: loserId }, data: { personId: survivorId } });
      await tx.payment.updateMany({ where: { partyId: loserId }, data: { partyId: survivorId } });
      await tx.alaCarteBooking.updateMany({ where: { clientId: loserId }, data: { clientId: survivorId } });
      await tx.chatMessage.updateMany({ where: { senderId: loserId }, data: { senderId: survivorId } });
      await tx.conversation.updateMany({ where: { createdById: loserId }, data: { createdById: survivorId } });
      await tx.pairing.updateMany({ where: { playerAId: loserId }, data: { playerAId: survivorId } });
      await tx.pairing.updateMany({ where: { playerBId: loserId }, data: { playerBId: survivorId } });
      await tx.team.updateMany({ where: { teamContactId: loserId }, data: { teamContactId: survivorId } });
      await tx.person.updateMany({ where: { guardianId: loserId }, data: { guardianId: survivorId } });
      await tx.user.updateMany({ where: { personId: loserId }, data: { personId: survivorId } });

      // Unique-constrained tables — reassign a row only if the survivor doesn't
      // already have one for the same key; otherwise drop the duplicate row.
      const dedupe = async (
        rows: { id: string; key: string }[],
        survivorKeys: Set<string>,
        reassign: (id: string) => Promise<unknown>,
        remove: (id: string) => Promise<unknown>,
      ) => {
        for (const r of rows) {
          if (survivorKeys.has(r.key)) await remove(r.id);
          else { await reassign(r.id); survivorKeys.add(r.key); }
        }
      };

      const tm = await tx.teamMember.findMany({ where: { personId: loserId }, select: { id: true, teamId: true } });
      const tmKeys = new Set((await tx.teamMember.findMany({ where: { personId: survivorId }, select: { teamId: true } })).map((r) => r.teamId));
      await dedupe(tm.map((r) => ({ id: r.id, key: r.teamId })), tmKeys,
        (id) => tx.teamMember.update({ where: { id }, data: { personId: survivorId } }),
        (id) => tx.teamMember.delete({ where: { id } }));

      const att = await tx.attendance.findMany({ where: { personId: loserId }, select: { id: true, sessionId: true } });
      const attKeys = new Set((await tx.attendance.findMany({ where: { personId: survivorId }, select: { sessionId: true } })).map((r) => r.sessionId));
      await dedupe(att.map((r) => ({ id: r.id, key: r.sessionId })), attKeys,
        (id) => tx.attendance.update({ where: { id }, data: { personId: survivorId } }),
        (id) => tx.attendance.delete({ where: { id } }));

      const av = await tx.availabilityConfirmation.findMany({ where: { personId: loserId }, select: { id: true, fixtureId: true } });
      const avKeys = new Set((await tx.availabilityConfirmation.findMany({ where: { personId: survivorId }, select: { fixtureId: true } })).map((r) => r.fixtureId));
      await dedupe(av.map((r) => ({ id: r.id, key: r.fixtureId })), avKeys,
        (id) => tx.availabilityConfirmation.update({ where: { id }, data: { personId: survivorId } }),
        (id) => tx.availabilityConfirmation.delete({ where: { id } }));

      const mr = await tx.messageRecipient.findMany({ where: { personId: loserId }, select: { id: true, messageId: true } });
      const mrKeys = new Set((await tx.messageRecipient.findMany({ where: { personId: survivorId }, select: { messageId: true } })).map((r) => r.messageId));
      await dedupe(mr.map((r) => ({ id: r.id, key: r.messageId })), mrKeys,
        (id) => tx.messageRecipient.update({ where: { id }, data: { personId: survivorId } }),
        (id) => tx.messageRecipient.delete({ where: { id } }));

      const cp = await tx.conversationParticipant.findMany({ where: { personId: loserId }, select: { id: true, conversationId: true } });
      const cpKeys = new Set((await tx.conversationParticipant.findMany({ where: { personId: survivorId }, select: { conversationId: true } })).map((r) => r.conversationId));
      await dedupe(cp.map((r) => ({ id: r.id, key: r.conversationId })), cpKeys,
        (id) => tx.conversationParticipant.update({ where: { id }, data: { personId: survivorId } }),
        (id) => tx.conversationParticipant.delete({ where: { id } }));

      const cn = await tx.coachingNote.findMany({ where: { personId: loserId }, select: { id: true, teamId: true, week: true } });
      const cnKeys = new Set((await tx.coachingNote.findMany({ where: { personId: survivorId }, select: { teamId: true, week: true } })).map((r) => `${r.teamId}#${r.week}`));
      await dedupe(cn.map((r) => ({ id: r.id, key: `${r.teamId}#${r.week}` })), cnKeys,
        (id) => tx.coachingNote.update({ where: { id }, data: { personId: survivorId } }),
        (id) => tx.coachingNote.delete({ where: { id } }));

      // Rewrite consolidated-payment coverage arrays that name the loser.
      const covered = await tx.payment.findMany({ where: { coveredPersonIds: { not: null as unknown as undefined } }, select: { id: true, coveredPersonIds: true } });
      for (const p of covered) {
        const ids = Array.isArray(p.coveredPersonIds) ? (p.coveredPersonIds as string[]) : [];
        if (ids.includes(loserId)) {
          const next = [...new Set(ids.map((x) => (x === loserId ? survivorId : x)))];
          await tx.payment.update({ where: { id: p.id }, data: { coveredPersonIds: next } });
        }
      }

      // Backfill fields the survivor is missing from the loser.
      await tx.person.update({
        where: { id: survivorId },
        data: {
          email: survivor.email ?? loser.email,
          phone: survivor.phone ?? loser.phone,
          duprId: survivor.duprId ?? loser.duprId,
          duprRating: survivor.duprRating ?? loser.duprRating,
          waiverSignedAt: survivor.waiverSignedAt ?? loser.waiverSignedAt,
          guardianId: survivor.guardianId ?? loser.guardianId,
          stripeCustomerId: survivor.stripeCustomerId ?? loser.stripeCustomerId,
        },
      });

      await tx.person.delete({ where: { id: loserId } });
    });
  } catch {
    return back("?err=mergefail");
  }

  await audit({ actorId: actor.userId, entityType: "Person", entityId: survivorId, action: "person.merge", summary: `Merged ${loser.firstName} ${loser.lastName} into ${survivor.firstName} ${survivor.lastName}` });
  return back("?ok=merged");
}
