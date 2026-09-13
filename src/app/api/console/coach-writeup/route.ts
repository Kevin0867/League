import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { WRITEUP_CATEGORIES } from "@/lib/domain/coachWriteups";
import { appUrl } from "@/lib/stripe";

// Admin-only coach write-ups: create / edit / delete a note about a coach, and
// share it with the coach (or admins) when the admin chooses.
export const dynamic = "force-dynamic";

const VALID = new Set(WRITEUP_CATEGORIES.map((c) => c.value));

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const op = String(fd.get("op") ?? "");
  const personId = String(fd.get("personId") ?? "").trim();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/coaches/${personId}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return NextResponse.redirect(new URL(`/login`, origin), 303);

  // A coach can acknowledge a write-up that was shared with them. This is the
  // one op available to the coach themselves — everything else is admin-only.
  if (op === "acknowledge") {
    const id = String(fd.get("id") ?? "").trim();
    const mine = new URL(`/console/writeups/mine`, origin);
    const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
    const wu = id ? await prisma.coachWriteup.findUnique({ where: { id } }) : null;
    // Only the coach the write-up is about, and only once it's been shared.
    if (!wu || !wu.sharedWithCoachAt || !me?.personId || wu.personId !== me.personId) {
      mine.searchParams.set("wuerr", "auth");
      return NextResponse.redirect(mine, 303);
    }
    if (!wu.acknowledgedAt) {
      await prisma.coachWriteup.update({ where: { id: wu.id }, data: { acknowledgedAt: new Date() } });
      await audit({ actorId: actor.userId, entityType: "Person", entityId: wu.personId, action: "coach.writeup.acknowledge", summary: `Coach acknowledged a write-up` });
    }
    mine.searchParams.set("wuok", "acked");
    return NextResponse.redirect(mine, 303);
  }

  if (!can(actor.role, "manageCoaches")) return back("?wuerr=auth");
  if (!personId) return back("?wuerr=fields");

  const parseWhen = (v: FormDataEntryValue | null): Date => {
    const d = new Date(String(v ?? ""));
    return isNaN(d.getTime()) ? new Date() : d;
  };
  const category = (() => { const c = String(fd.get("category") ?? "NOTE"); return VALID.has(c) ? c : "NOTE"; })();

  if (op === "create") {
    const notes = String(fd.get("notes") ?? "").trim();
    const from = String(fd.get("from") ?? "");
    if (!notes) {
      return from === "overview"
        ? NextResponse.redirect(new URL(`/console/writeups?wuerr=notes`, origin), 303)
        : back("?wuerr=notes");
    }
    const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { person: { select: { firstName: true, lastName: true } } } });
    const authorName = me?.person ? `${me.person.firstName} ${me.person.lastName}`.trim() : null;
    await prisma.coachWriteup.create({
      data: { personId, authorId: actor.userId, authorName, occurredAt: parseWhen(fd.get("occurredAt")), category, notes },
    });
    await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "coach.writeup.create", summary: `Added a ${category} write-up` });
    return from === "overview"
      ? NextResponse.redirect(new URL(`/console/writeups?wuok=added`, origin), 303)
      : back("?wuok=added");
  }

  if (op === "update") {
    const id = String(fd.get("id") ?? "").trim();
    const notes = String(fd.get("notes") ?? "").trim();
    if (!id || !notes) return back("?wuerr=notes");
    await prisma.coachWriteup.update({ where: { id }, data: { occurredAt: parseWhen(fd.get("occurredAt")), category, notes } });
    await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "coach.writeup.update", summary: `Edited a write-up` });
    return back("?wuok=saved");
  }

  if (op === "delete") {
    const id = String(fd.get("id") ?? "").trim();
    if (id) await prisma.coachWriteup.deleteMany({ where: { id, personId } });
    await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "coach.writeup.delete", summary: `Deleted a write-up` });
    return back("?wuok=deleted");
  }

  if (op === "shareCoach") {
    const id = String(fd.get("id") ?? "").trim();
    const wu = id ? await prisma.coachWriteup.findFirst({ where: { id, personId } }) : null;
    if (!wu) return back("?wuerr=fields");
    const label = WRITEUP_CATEGORIES.find((c) => c.value === wu.category)?.label ?? "Note";
    const when = wu.occurredAt.toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" });
    await dispatchMessage({
      senderId: actor.userId,
      audienceType: "SINGLE_PERSON",
      audienceRef: personId,
      channels: ["IN_APP", "EMAIL", "SMS"],
      triggerType: "COACH_WRITEUP",
      subject: `A note from PURE Academy — ${label}`,
      body: `${label} · ${when}\n\n${wu.notes}\n\nView it and acknowledge here: ${appUrl()}/console/writeups/mine\n\nPlease reach out to the Director with any questions.`,
      smsBody: `PURE Academy — the Director shared a note with you (${label}). View & acknowledge: ${appUrl()}/console/writeups/mine`,
    }).catch(() => {});
    await prisma.coachWriteup.update({ where: { id: wu.id }, data: { sharedWithCoachAt: new Date() } });
    await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "coach.writeup.share", summary: `Shared a write-up with the coach` });
    return back("?wuok=shared");
  }

  if (op === "shareAdmins") {
    const id = String(fd.get("id") ?? "").trim();
    const wu = id ? await prisma.coachWriteup.findFirst({ where: { id, personId } }) : null;
    if (!wu) return back("?wuerr=fields");
    const coach = await prisma.person.findUnique({ where: { id: personId }, select: { firstName: true, lastName: true } });
    const label = WRITEUP_CATEGORIES.find((c) => c.value === wu.category)?.label ?? "Note";
    const when = wu.occurredAt.toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" });
    await dispatchMessage({
      senderId: actor.userId,
      audienceType: "ALL_ADMINS",
      channels: ["IN_APP", "EMAIL"],
      triggerType: "COACH_WRITEUP",
      subject: `Coach write-up — ${coach ? `${coach.firstName} ${coach.lastName}` : "coach"} (${label})`,
      body: `Coach: ${coach ? `${coach.firstName} ${coach.lastName}` : personId}\n${label} · ${when}\nBy: ${wu.authorName ?? "an admin"}\n\n${wu.notes}`,
    }).catch(() => {});
    await audit({ actorId: actor.userId, entityType: "Person", entityId: personId, action: "coach.writeup.shareAdmins", summary: `Shared a write-up with admins` });
    return back("?wuok=sharedadmins");
  }

  return back("?wuerr=op");
}
