import { NextResponse } from "next/server";
import { acceptWaitlistOffer, declineWaitlistOffer } from "@/lib/domain/teamWaitlist";

// PUBLIC: a waitlisted person accepts (or declines) the spot they were offered.
// Reached from the text/email offer link. No login required — the offer token
// authorizes the action.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const token = String(fd.get("token") ?? "").trim();
  const op = String(fd.get("op") ?? "accept");
  const back = (qs: string) => NextResponse.redirect(new URL(`/waitlist/accept${qs}`, origin), 303);

  if (!token) return back("?done=invalid");

  if (op === "decline") {
    await declineWaitlistOffer(token);
    return back("?done=declined");
  }

  const res = await acceptWaitlistOffer(token);
  if (!res.ok) return back(`?token=${encodeURIComponent(token)}&done=${res.reason}`);
  return back(`?done=accepted&team=${encodeURIComponent(res.teamName)}`);
}
