import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyFeedbackToken } from "@/lib/domain/feedback";

// Public feedback submission (tokenized, no login). Creates a Feedback row for
// admin review; publishing is a separate admin action and requires consent.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const token = String(fd.get("token") ?? "");
  const data = await verifyFeedbackToken(token);
  const back = (qs: string) => NextResponse.redirect(new URL(`/feedback/${encodeURIComponent(token)}${qs}`, origin), 303);
  if (!data) return back("?err=expired");

  const ratingRaw = parseInt(String(fd.get("rating") ?? ""), 10);
  const rating = Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : null;
  const body = String(fd.get("body") ?? "").trim().slice(0, 1500) || null;
  const coachId = String(fd.get("coachId") ?? "").trim() || null;
  const respondentName = String(fd.get("respondentName") ?? "").trim().slice(0, 120) || null;
  const consentPublish = String(fd.get("consentPublish") ?? "") === "1";

  if (!body && !rating) return back("?err=empty");

  // Only accept a coachId that the submitter could legitimately reference.
  let coach: string | null = null;
  if (coachId) {
    const exists = await prisma.coach.findUnique({ where: { id: coachId }, select: { id: true } });
    coach = exists ? coachId : null;
  }

  await prisma.feedback.create({
    data: {
      seasonId: data.seasonId,
      personId: data.personId,
      respondentName,
      coachId: coach,
      rating,
      body,
      consentPublish,
      phase: data.phase,
      status: "NEW",
    },
  });

  return back("?ok=1");
}
