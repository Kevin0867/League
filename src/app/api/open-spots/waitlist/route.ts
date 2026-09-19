import { NextResponse } from "next/server";
import { joinTeamWaitlist } from "@/lib/domain/openSpots";

// PUBLIC: a family joins a full team's waitlist from the Open Spots page. No
// login, no charge, no placement — they're recorded on the team's waitlist and
// an admin places them when a spot opens.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const teamId = String(fd.get("teamId") ?? "").trim();
  const firstName = String(fd.get("firstName") ?? "").trim();
  const lastName = String(fd.get("lastName") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim() || null;
  const phone = String(fd.get("phone") ?? "").trim() || null;
  const dobStr = String(fd.get("dob") ?? "").trim();
  const back = (qs: string) => NextResponse.redirect(new URL(`/open-spots${qs}`, origin), 303);

  if (!teamId) return back("?wlerr=fields#join");
  const dob = dobStr ? new Date(dobStr) : null;
  const res = await joinTeamWaitlist({ teamId, firstName, lastName, email, phone, dob });
  if (!res.ok) return back(`?wlerr=${res.reason}#join`);
  return back(`?wlok=${encodeURIComponent(res.teamName)}#join`);
}
