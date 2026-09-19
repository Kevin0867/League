import { NextResponse } from "next/server";
import { advanceAllWaitlists } from "@/lib/domain/teamWaitlist";

// Runs periodically. For every team with waitlist activity, expires any offer
// whose 24-hour window has lapsed and — if the team has room and no live offer —
// offers the spot to the next person in line (text + email). This is what makes
// an unaccepted offer roll to the 2nd person, then the 3rd, and so on. Protected
// by CRON_SECRET.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const { teams } = await advanceAllWaitlists();
  return NextResponse.json({ ok: true, teams });
}
