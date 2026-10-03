import { NextResponse } from "next/server";
import { chargeUpcomingLessons, remindUpcomingLessons, releaseAbandonedLessons } from "@/lib/domain/lessonBilling";

// Per-lesson billing engine (Phase 4). Runs on a short interval and does three
// jobs for player-booked lessons:
//   1. Auto-charge the saved card for each later lesson coming up (first lessons
//      are paid at booking); on decline or no saved card, email a pay link + alert.
//   2. Send the "your lesson is today" reminder to the player and the coach.
//   3. Release the court held by a booking whose first lesson was never paid.
// Protected by CRON_SECRET. Idempotent (per-booking markers + a charge
// idempotency key), so overlapping runs never double-charge or double-text.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const now = new Date();
  const charges = await chargeUpcomingLessons(now);
  const reminders = await remindUpcomingLessons(now);
  const released = await releaseAbandonedLessons(now);

  return NextResponse.json({ charges, reminders, released });
}
