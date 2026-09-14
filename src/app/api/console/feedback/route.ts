import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { getSeasonStats } from "@/lib/domain/seasonStats";
import { sendFeedbackCampaign } from "@/lib/domain/feedbackCampaign";

// Season feedback: send the thank-you + feedback request to every family
// (mid-season / end-of-season), and moderate/publish the responses. Admin only.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/feedback${qs}`, origin), 303);
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.roles, "manageTeams")) return back("?err=auth");
  const op = String(fd.get("op") ?? "");

  // Text + email every season family a thank-you and a tokenized feedback link.
  if (op === "sendCampaign") {
    const phase = String(fd.get("phase") ?? "GENERAL");
    const stats = await getSeasonStats();
    const seasonId = stats.season?.id ?? null;
    if (!seasonId) return back("?err=noseason");

    // Distinct players registered (active) this season.
    const regs = await prisma.registration.findMany({
      where: { seasonId, status: { notIn: ["WITHDRAWN", "DUPLICATE", "MERGED"] } },
      select: { personId: true },
    });
    const personIds = [...new Set(regs.map((r) => r.personId))];

    const sent = await sendFeedbackCampaign({ senderId: actor.userId, seasonId, phase, personIds });
    // A manual mid-season send also stamps the season, so the automated end-of-
    // week-6 send doesn't fire a duplicate.
    if (phase === "MIDSEASON") await prisma.season.update({ where: { id: seasonId }, data: { midseasonFeedbackSentAt: new Date() } }).catch(() => {});
    await audit({ actorId: actor.userId, entityType: "Feedback", entityId: "campaign", action: "FEEDBACK_CAMPAIGN", summary: `Sent ${phase} feedback request to ${sent} famil${sent === 1 ? "y" : "ies"}` });
    return back(`?ok=sent&n=${sent}&phase=${encodeURIComponent(phase)}`);
  }

  // Request feedback from ONE team's families — anytime, from the team page.
  if (op === "sendTeamFeedback") {
    const teamId = String(fd.get("teamId") ?? "");
    const rawReturn = String(fd.get("returnTo") ?? "");
    const returnTo = rawReturn.startsWith("/console/teams/") ? rawReturn : `/console/teams/${teamId}`;
    const backTeam = (qs: string) => NextResponse.redirect(new URL(`${returnTo}${qs}`, origin), 303);
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { seasonId: true, coachId: true, members: { select: { personId: true } } },
    });
    if (!team) return backTeam("?err=notfound");
    const personIds = [...new Set(team.members.map((m) => m.personId))];
    if (personIds.length === 0) return backTeam("?err=noplayers");
    const sent = await sendFeedbackCampaign({ senderId: actor.userId, seasonId: team.seasonId, phase: "GENERAL", personIds, coachId: team.coachId });
    await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "FEEDBACK_CAMPAIGN_TEAM", summary: `Requested feedback from ${sent} team famil${sent === 1 ? "y" : "ies"}` });
    return backTeam(`?ok=teamfeedback&n=${sent}`);
  }

  // Moderate one response.
  if (op === "setStatus") {
    const id = String(fd.get("id") ?? "");
    const status = String(fd.get("status") ?? "");
    if (!["NEW", "REVIEWED", "HIDDEN"].includes(status)) return back("?err=bad");
    await prisma.feedback.update({ where: { id }, data: { status, ...(status === "HIDDEN" ? { published: false } : {}) } });
    return back("?ok=moderated");
  }

  // Publish / unpublish a testimonial (publish requires the family's consent).
  if (op === "publish") {
    const id = String(fd.get("id") ?? "");
    const on = String(fd.get("on") ?? "") === "1";
    const row = await prisma.feedback.findUnique({ where: { id }, select: { consentPublish: true } });
    if (!row) return back("?err=notfound");
    if (on && !row.consentPublish) return back("?err=noconsent");
    await prisma.feedback.update({ where: { id }, data: { published: on, ...(on ? { status: "REVIEWED" } : {}) } });
    await audit({ actorId: actor.userId, entityType: "Feedback", entityId: id, action: on ? "FEEDBACK_PUBLISH" : "FEEDBACK_UNPUBLISH", summary: on ? "Published testimonial" : "Unpublished testimonial" });
    return back(on ? "?ok=published" : "?ok=unpublished");
  }

  return back("?err=op");
}
