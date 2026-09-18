import { NextResponse } from "next/server";
import { claimPracticeSub } from "@/lib/domain/practiceSub";

// PUBLIC: someone claims an open substitute spot for one practice from the
// Open Spots page. No login, no charge. Creates the sub, sends the waiver +
// confirmation, and notifies the coach + team.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const sessionId = String(fd.get("sessionId") ?? "").trim();
  const teamId = String(fd.get("teamId") ?? "").trim();
  const firstName = String(fd.get("firstName") ?? "").trim();
  const lastName = String(fd.get("lastName") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim() || null;
  const phone = String(fd.get("phone") ?? "").trim() || null;
  const dobStr = String(fd.get("dob") ?? "").trim();
  const back = (qs: string) => NextResponse.redirect(new URL(`/open-spots${qs}`, origin), 303);

  if (!sessionId || !teamId) return back("?suberr=fields#subs");
  const dob = dobStr ? new Date(dobStr) : null;
  const res = await claimPracticeSub({ sessionId, teamId, firstName, lastName, email, phone, dob });
  if (!res.ok) return back(`?suberr=${res.reason}#subs`);
  return back(`?subok=${encodeURIComponent(res.teamName)}#subs`);
}
