import { NextResponse } from "next/server";
import { syncAllCoachCalendars } from "@/lib/domain/coachCalendarSync";

// Phase 6 — phone-calendar busy-import. Reads each coach's external calendar
// subscribe link and caches their busy times as CoachBusyBlock rows so lessons
// are never offered when the coach is already committed elsewhere. Protected by
// CRON_SECRET. One-way and read-only; it never writes to the coach's calendar.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const result = await syncAllCoachCalendars(new Date());
  return NextResponse.json(result);
}
