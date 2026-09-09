import "server-only";
import { prisma } from "@/lib/db";

// Keep a team's assistant coaches attached to its practice sessions as ASSISTANT
// SessionCoach rows, so they're paid (at the assistant rate) for each session the
// team holds — the same payout path as head coaches and subs.

/** Add a coach as ASSISTANT on all of a team's live sessions (idempotent; never
 *  downgrades an existing PRIMARY/SUBSTITUTE row for that coach). */
export async function addTeamAssistantToSessions(teamId: string, coachId: string): Promise<void> {
  const sessions = await prisma.session.findMany({
    where: { teams: { some: { teamId } }, status: { in: ["SCHEDULED", "DELIVERED"] } },
    select: { id: true },
  });
  for (const s of sessions) {
    await prisma.sessionCoach.upsert({
      where: { sessionId_coachId: { sessionId: s.id, coachId } },
      create: { sessionId: s.id, coachId, role: "ASSISTANT", payable: true },
      update: {}, // leave an existing row (e.g. they're the sub here) untouched
    });
  }
}

/** Remove a coach's ASSISTANT rows from a team's sessions (leaves any
 *  PRIMARY/SUBSTITUTE rows for that coach intact). */
export async function removeTeamAssistantFromSessions(teamId: string, coachId: string): Promise<void> {
  const sessions = await prisma.session.findMany({ where: { teams: { some: { teamId } } }, select: { id: true } });
  const ids = sessions.map((s) => s.id);
  if (ids.length) {
    await prisma.sessionCoach.deleteMany({ where: { sessionId: { in: ids }, coachId, role: "ASSISTANT" } });
  }
}
