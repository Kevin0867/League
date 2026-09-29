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

/**
 * Move a team's head-coach slot from the OUTGOING head to the INCOMING head on
 * every PRACTICE session: the new head becomes the PRIMARY coach (paid, unless a
 * substitute already covers that session — then the sub keeps the pay and the new
 * head is just the coach-of-record), and the outgoing head's rows are removed. So
 * when a team's coach is reassigned, the practice pay follows the new coach
 * instead of lingering on the previous one. Individual sessions a different coach
 * actually worked can then be marked with that coach as a substitute.
 *
 * Only sessions the outgoing head was assigned to are touched. On a first-time
 * assignment (no outgoing head) a session that already has a paid PRIMARY is left
 * alone, so this never steals a session someone is already the coach of.
 */
/**
 * Make the team's CURRENT head coach the PRIMARY coach on every practice session,
 * removing any leftover PRIMARY row for a replaced coach. A session covered by a
 * substitute keeps the sub (and the head is unpaid there). Use to clean up a team
 * whose head coach was changed before reassignment learned to move the sessions —
 * so the practices show (and pay) the real coach without adding subs by hand.
 * Returns the number of sessions whose primary coach changed.
 */
export async function syncTeamPracticeCoachesToHead(teamId: string): Promise<number> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { coachId: true } });
  if (!team?.coachId) return 0;
  const headId = team.coachId;
  const sessions = await prisma.session.findMany({
    where: { type: "PRACTICE", teams: { some: { teamId } } },
    select: { id: true, coaches: { select: { coachId: true, role: true, payable: true } } },
  });
  let changed = 0;
  for (const s of sessions) {
    const hasPayableSub = s.coaches.some((c) => c.payable && c.role === "SUBSTITUTE");
    const stalePrimaries = s.coaches.filter((c) => c.role === "PRIMARY" && c.coachId !== headId);
    const headRow = s.coaches.find((c) => c.coachId === headId);
    const headNeedsFix = !headRow || headRow.role !== "PRIMARY" || headRow.payable === hasPayableSub; // payable should be !hasPayableSub
    if (!stalePrimaries.length && !headNeedsFix) continue;
    if (stalePrimaries.length) {
      await prisma.sessionCoach.deleteMany({ where: { sessionId: s.id, coachId: { in: stalePrimaries.map((c) => c.coachId) }, role: "PRIMARY" } });
    }
    await prisma.sessionCoach.upsert({
      where: { sessionId_coachId: { sessionId: s.id, coachId: headId } },
      create: { sessionId: s.id, coachId: headId, role: "PRIMARY", payable: !hasPayableSub },
      update: { role: "PRIMARY", payable: !hasPayableSub },
    });
    changed++;
  }
  return changed;
}

export async function reassignTeamHeadOnSessions(teamId: string, oldCoachId: string | null, newCoachId: string): Promise<void> {
  if (!newCoachId || oldCoachId === newCoachId) return;
  const sessions = await prisma.session.findMany({
    where: { type: "PRACTICE", teams: { some: { teamId } } },
    select: { id: true, coaches: { select: { coachId: true, role: true, payable: true } } },
  });
  for (const s of sessions) {
    if (oldCoachId) {
      if (!s.coaches.some((c) => c.coachId === oldCoachId)) continue; // outgoing head not here
    } else if (s.coaches.some((c) => c.payable && c.role === "PRIMARY" && c.coachId !== newCoachId)) {
      continue; // someone else is already the paid coach — don't override
    }
    // A substitute (not either head) already being paid keeps that session.
    const hasPayableSub = s.coaches.some(
      (c) => c.payable && c.role === "SUBSTITUTE" && c.coachId !== oldCoachId && c.coachId !== newCoachId,
    );
    if (oldCoachId) {
      await prisma.sessionCoach.deleteMany({ where: { sessionId: s.id, coachId: oldCoachId } });
    }
    await prisma.sessionCoach.upsert({
      where: { sessionId_coachId: { sessionId: s.id, coachId: newCoachId } },
      create: { sessionId: s.id, coachId: newCoachId, role: "PRIMARY", payable: !hasPayableSub },
      update: { role: "PRIMARY", payable: !hasPayableSub },
    });
  }
}
