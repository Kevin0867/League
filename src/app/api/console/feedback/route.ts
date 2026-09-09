import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { dispatchMessage } from "@/lib/messaging";
import { signFeedbackToken } from "@/lib/domain/feedback";
import { getSeasonStats } from "@/lib/domain/seasonStats";
import { appUrl } from "@/lib/stripe";

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
    const phaseWord = phase === "MIDSEASON" ? "how the season is going" : phase === "ENDSEASON" ? "the Fall season" : "your experience";
    const stats = await getSeasonStats();
    const seasonId = stats.season?.id ?? null;
    if (!seasonId) return back("?err=noseason");

    // Distinct players registered (active) this season.
    const regs = await prisma.registration.findMany({
      where: { seasonId, status: { notIn: ["WITHDRAWN", "DUPLICATE", "MERGED"] } },
      select: { personId: true },
    });
    const personIds = [...new Set(regs.map((r) => r.personId))];

    let sent = 0;
    for (const personId of personIds) {
      const token = await signFeedbackToken(personId, seasonId, phase);
      const link = `${appUrl()}/feedback/${token}`;
      const res = await dispatchMessage({
        senderId: actor.userId, seasonId,
        audienceType: "SINGLE_PERSON", audienceRef: personId,
        channels: ["EMAIL", "SMS"], triggerType: "SEASON_FEEDBACK",
        subject: "Thank you for a great season — a quick favor?",
        body: `Thank you for being part of the PURE Academy Fall Season! We'd love your quick feedback on ${phaseWord} — and if a coach made a difference, a testimonial we might feature on their profile. It takes a minute: ${link}`,
        smsBody: `PURE Academy — thank you for a great season! A quick note on ${phaseWord} (and your coach) would mean a lot: ${link}`,
      });
      if (!res.failures) sent++;
    }
    await audit({ actorId: actor.userId, entityType: "Feedback", entityId: "campaign", action: "FEEDBACK_CAMPAIGN", summary: `Sent ${phase} feedback request to ${sent} famil${sent === 1 ? "y" : "ies"}` });
    return back(`?ok=sent&n=${sent}&phase=${encodeURIComponent(phase)}`);
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
