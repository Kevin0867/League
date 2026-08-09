import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findNewlyAdultMinors, flagAndNotify } from "@/lib/domain/waiverRenewal";

// Daily job (Vercel Cron, see vercel.json): find minors who have turned 18,
// invalidate their parent-signed waiver, and email them a link to sign the
// adult waiver. Protected by CRON_SECRET when set.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const db = prisma as unknown as PrismaClient;
  const people = await findNewlyAdultMinors(db);
  let flagged = 0;
  let emailed = 0;
  for (const p of people) {
    const r = await flagAndNotify(db, p);
    if (r === "flagged") {
      flagged++;
      if (p.email) emailed++;
    }
  }
  return NextResponse.json({ checked: people.length, flagged, emailed });
}
