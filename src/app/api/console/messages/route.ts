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

// Broad audiences require broadcast permission (COO/Director). A coach may
// message their OWN team only (§17 — permissions attach to the team-contact role).
const BROAD: AudienceType[] = ["ALL_PLAYERS", "ALL_COACHES", "MARKET", "DIVISION"];

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/messages${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  const op = String(formData.get("op") ?? "");

  switch (op) {
    case "send": {
      if (!actor) return back("?err=auth");

      const audienceType = String(formData.get("audienceType") ?? "") as AudienceType;
      const audienceRef = String(formData.get("audienceRef") ?? "") || null;
      const subject = String(formData.get("subject") ?? "").trim();
      const body = String(formData.get("body") ?? "").trim();
      const channels = (["IN_APP", "EMAIL", "SMS"] as Channel[]).filter(
        (c) => formData.get(`channel_${c}`) === "on"
      );

      if (!body) return back("?err=body");
      if (channels.length === 0) return back("?err=channels");

      // Authorization.
      const broadcaster = can(actor.role, "broadcastAll");
      if (BROAD.includes(audienceType) && !broadcaster) return back("?err=perm");
      if (audienceType === "TEAM" && !broadcaster) {
        // Coaches may only message a team they coach. The ticket carries only
        // userId + role, so resolve this actor's personId to compare.
        const actorUser = await prisma.user.findUnique({
          where: { id: actor.userId },
          select: { personId: true },
        });
        const team = audienceRef
          ? await prisma.team.findUnique({ where: { id: audienceRef }, include: { coach: true } })
          : null;
        if (!team || team.coach?.personId !== actorUser?.personId) return back("?err=team");
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

      return back(`?ok=1&n=${result.recipients}&failed=${result.failures}`);
    }
    default:
      return back("?err=op");
  }
}
