import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { dispatchMessage, type Channel } from "@/lib/messaging";
import type { AudienceType } from "@/lib/domain/audience";

// Message compose as a native-form-POST route handler with ticket auth. Route
// handlers 303-redirect to a fresh GET (which carries the session cookie), so
// unlike a server action they don't re-render inline under the cookieless POST
// and bounce through the console layout's auth.
export const dynamic = "force-dynamic";

// Admin-only broad audiences (the whole club). A coach may reach staff broadcast
// audiences (all coaches, all admins) and any team they coach.
const ADMIN_ONLY: AudienceType[] = ["ALL_PLAYERS", "MARKET", "DIVISION"];
const STAFF_BROADCAST: AudienceType[] = ["ALL_COACHES", "ALL_ADMINS"];

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const rawReturn = String(formData.get("returnTo") ?? "");
  const returnBase = rawReturn.startsWith("/console/") ? rawReturn : "/console/messages";
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`${returnBase}${qs}`, origin), 303);

  const actor = await actorFromForm(formData);
  const op = String(formData.get("op") ?? "");

  switch (op) {
    // Mark a received broadcast/announcement read or unread — scoped to the
    // signed-in staff person's own recipient row, so the Announcements badge and
    // banner clear. "markAllRead" clears everything they've received.
    case "markBroadcastRead":
    case "markBroadcastUnread":
    case "markAllBroadcastsRead": {
      if (!actor) return back("?err=auth");
      const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
      if (!me?.personId) return back("?err=perm");
      if (op === "markAllBroadcastsRead") {
        await prisma.messageRecipient.updateMany({
          where: { personId: me.personId, readAt: null },
          data: { readAt: new Date(), inAppStatus: "READ" },
        });
        return back("?ok=readall");
      }
      const recipientId = String(formData.get("recipientId") ?? "").trim();
      if (!recipientId) return back("?err=body");
      const read = op === "markBroadcastRead";
      await prisma.messageRecipient.updateMany({
        where: { id: recipientId, personId: me.personId },
        data: { readAt: read ? new Date() : null, inAppStatus: read ? "READ" : "DELIVERED" },
      });
      return back(read ? "?ok=read" : "?ok=unread");
    }

    case "send": {
      if (!actor) return back("?err=auth");

      // The composer can encode a team choice as "TEAM:<teamId>" in one select.
      let audienceType = String(formData.get("audienceType") ?? "") as AudienceType;
      let audienceRef = String(formData.get("audienceRef") ?? "") || null;
      if (audienceType.startsWith("TEAM:")) {
        audienceRef = audienceType.slice(5);
        audienceType = "TEAM";
      }
      const subject = String(formData.get("subject") ?? "").trim();
      const body = String(formData.get("body") ?? "").trim();
      const channels = (["IN_APP", "EMAIL", "SMS"] as Channel[]).filter(
        (c) => formData.get(`channel_${c}`) === "on"
      );

      if (!body) return back("?err=body");
      if (channels.length === 0) return back("?err=channels");

      // Authorization.
      const broadcaster = can(actor.role, "broadcastAll");
      if (ADMIN_ONLY.includes(audienceType) && !broadcaster) return back("?err=perm");

      // Resolve this actor's coach identity once (the ticket carries only
      // userId + role) — used to gate staff broadcasts and team messages.
      const needsCoachCheck =
        !broadcaster && (STAFF_BROADCAST.includes(audienceType) || audienceType === "TEAM");
      const actorCoach = needsCoachCheck
        ? await prisma.user
            .findUnique({ where: { id: actor.userId }, select: { personId: true } })
            .then((u) => (u?.personId ? prisma.coach.findUnique({ where: { personId: u.personId }, select: { id: true } }) : null))
        : null;

      if (STAFF_BROADCAST.includes(audienceType) && !broadcaster && !actorCoach) return back("?err=perm");
      if (audienceType === "TEAM" && !broadcaster) {
        const team = audienceRef
          ? await prisma.team.findUnique({
              where: { id: audienceRef },
              select: { coachId: true, assistantCoaches: { select: { coachId: true } } },
            })
          : null;
        const owns =
          !!actorCoach && !!team &&
          (team.coachId === actorCoach.id || team.assistantCoaches.some((a) => a.coachId === actorCoach.id));
        if (!owns) return back("?err=team");
      }

      const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" } });

      const result = await dispatchMessage({
        senderId: actor.userId,
        seasonId: season?.id ?? null,
        audienceType,
        audienceRef,
        channels,
        subject: subject || undefined,
        body,
      });

      if (result.recipients === 0) return back("?err=norecipients");

      return back(`?ok=1&n=${result.recipients}&failed=${result.failures}&nophone=${result.noPhone}&noemail=${result.noEmail}`);
    }

    // Whole-platform announcement — the admin ticks the categories to reach and
    // we send one message to the deduped union.
    case "announce": {
      if (!actor) return back("?err=auth");
      if (!can(actor.role, "broadcastAll")) return back("?err=perm");

      const cats = ["players", "parents", "coaches", "admins"].filter((c) => formData.get(`cat_${c}`) === "on");
      if (cats.length === 0) return back("?err=nocat");

      const subject = String(formData.get("subject") ?? "").trim();
      const body = String(formData.get("body") ?? "").trim();
      const channels = (["IN_APP", "EMAIL", "SMS"] as Channel[]).filter((c) => formData.get(`channel_${c}`) === "on");
      if (!body) return back("?err=body");
      if (channels.length === 0) return back("?err=channels");

      const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" } });
      const result = await dispatchMessage({
        senderId: actor.userId,
        seasonId: season?.id ?? null,
        audienceType: "PLATFORM",
        audienceRef: cats.join(","),
        channels,
        subject: subject || undefined,
        body,
      });
      if (result.recipients === 0) return back("?err=norecipients");
      return back(`?ok=1&n=${result.recipients}&failed=${result.failures}`);
    }
    default:
      return back("?err=op");
  }
}
