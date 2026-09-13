import { prisma } from "@/lib/db";
import { coachCalendarIcs } from "@/lib/domain/coachCalendar";
import { familyCalendarIcs } from "@/lib/domain/familyCalendar";

// A coach's personal calendar subscription feed. The token in the URL is the
// secret (calendar apps can't send auth headers), so there's no session here —
// the feed is scoped to whichever coach owns the token. Returns text/calendar so
// Apple/Google Calendar can subscribe and auto-refresh.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return new Response("Not found", { status: 404 });

  // The token identifies either a coach's feed or a family's (portal) feed.
  const coach = await prisma.coach.findUnique({ where: { calendarToken: token }, select: { id: true } });
  const person = coach ? null : await prisma.person.findUnique({ where: { calendarToken: token }, select: { id: true } });
  if (!coach && !person) return new Response("Not found", { status: 404 });

  const ics = coach ? await coachCalendarIcs(coach.id) : await familyCalendarIcs(person!.id);
  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="pure-academy.ics"',
      "Cache-Control": "no-cache, must-revalidate",
    },
  });
}
