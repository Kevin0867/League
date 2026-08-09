"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { dispatchMessage, type Channel } from "@/lib/messaging";
import type { AudienceType } from "@/lib/domain/audience";

export type ComposeState = { ok?: boolean; message?: string; failures?: number };

// Broad audiences require broadcast permission (COO/Director). A coach may
// message their OWN team only (§17 — permissions attach to the team-contact role).
const BROAD: AudienceType[] = ["ALL_PLAYERS", "ALL_COACHES", "MARKET", "DIVISION"];

export async function sendMessage(
  _prev: ComposeState | undefined,
  formData: FormData
): Promise<ComposeState> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Not signed in." };

  const audienceType = String(formData.get("audienceType") ?? "") as AudienceType;
  const audienceRef = String(formData.get("audienceRef") ?? "") || null;
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const channels = (["IN_APP", "EMAIL", "SMS"] as Channel[]).filter(
    (c) => formData.get(`channel_${c}`) === "on"
  );

  if (!body) return { ok: false, message: "Message body is required." };
  if (channels.length === 0) return { ok: false, message: "Select at least one channel." };

  // Authorization.
  const broadcaster = can(session.role, "broadcastAll");
  if (BROAD.includes(audienceType) && !broadcaster) {
    return { ok: false, message: "You don't have permission to message that audience." };
  }
  if (audienceType === "TEAM" && !broadcaster) {
    // Coaches may only message a team they coach.
    const team = audienceRef
      ? await prisma.team.findUnique({ where: { id: audienceRef }, include: { coach: true } })
      : null;
    if (!team || team.coach?.personId !== session.personId) {
      return { ok: false, message: "You can only message your own team." };
    }
  }

  const season = await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" } });

  const result = await dispatchMessage({
    senderId: session.userId,
    seasonId: season?.id ?? null,
    audienceType,
    audienceRef,
    channels,
    subject: subject || undefined,
    body,
  });

  revalidatePath("/console/messages");

  if (result.recipients === 0) {
    return { ok: false, message: "No recipients matched that audience." };
  }
  return {
    ok: true,
    failures: result.failures,
    message:
      `Sent to ${result.recipients} recipient${result.recipients > 1 ? "s" : ""}` +
      (result.failures ? ` · ${result.failures} delivery failure${result.failures > 1 ? "s" : ""} flagged` : ""),
  };
}
