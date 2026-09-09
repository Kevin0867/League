import { prisma } from "@/lib/db";
import { verifyFeedbackToken } from "@/lib/domain/feedback";
import { FeedbackForm } from "./FeedbackForm";

export const dynamic = "force-dynamic";

export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const data = await verifyFeedbackToken(token);

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto max-w-xl px-4 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">{children}</div>
    </main>
  );

  if (sp.ok === "1") {
    return shell(
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Thank you! 🙌</h1>
        <p className="mt-2 text-slate-600">We appreciate you being part of the PURE Academy family. Your feedback helps our coaches grow.</p>
      </div>
    );
  }

  if (!data) {
    return shell(
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">This feedback link has expired</h1>
        <p className="mt-2 text-slate-600">Please use the most recent link we texted or emailed you, or contact us.</p>
      </div>
    );
  }

  const person = await prisma.person.findUnique({ where: { id: data.personId }, select: { firstName: true, lastName: true, guardianId: true } });

  // The coaches this family had this season — the respondent's own teams plus any
  // children they're the guardian of.
  const familyIds = [data.personId, ...(await prisma.person.findMany({ where: { guardianId: data.personId }, select: { id: true } })).map((p) => p.id)];
  const teamIds = data.seasonId
    ? (await prisma.teamMember.findMany({ where: { personId: { in: familyIds }, team: { seasonId: data.seasonId } }, select: { teamId: true } })).map((m) => m.teamId)
    : (await prisma.teamMember.findMany({ where: { personId: { in: familyIds } }, select: { teamId: true } })).map((m) => m.teamId);
  const teams = teamIds.length
    ? await prisma.team.findMany({ where: { id: { in: [...new Set(teamIds)] } }, include: { coach: { include: { person: true } }, assistantCoaches: { include: { coach: { include: { person: true } } } } } })
    : [];
  const coachMap = new Map<string, string>();
  for (const t of teams) {
    if (t.coach) coachMap.set(t.coach.id, `${t.coach.person.firstName} ${t.coach.person.lastName}`);
    for (const ac of t.assistantCoaches) coachMap.set(ac.coach.id, `${ac.coach.person.firstName} ${ac.coach.person.lastName}`);
  }
  // If the link names a coach (e.g. after a private lesson), make sure they're an
  // option and pre-selected.
  if (data.coachId && !coachMap.has(data.coachId)) {
    const c = await prisma.coach.findUnique({ where: { id: data.coachId }, select: { person: { select: { firstName: true, lastName: true } } } });
    if (c) coachMap.set(data.coachId, `${c.person.firstName} ${c.person.lastName}`);
  }
  const coaches = [...coachMap.entries()].map(([id, name]) => ({ id, name }));

  const afterLesson = data.phase === "ALACARTE";
  const phaseLabel = afterLesson
    ? "your session"
    : data.phase === "MIDSEASON" ? "how the season is going so far" : data.phase === "ENDSEASON" ? "the Fall season" : "your experience";

  return shell(
    <div>
      <h1 className="text-2xl font-bold text-slate-900">{afterLesson ? "Thanks for training with us! 🎾" : "Thanks for a great season! 🎾"}</h1>
      <p className="mt-2 text-slate-600">
        {person ? `Hi ${person.firstName}! ` : ""}Thank you for {afterLesson ? "your session with PURE Academy" : "being part of the PURE Academy Fall Season"}. We&apos;d love a quick note on {phaseLabel} — and if a coach made a difference, tell us (we may feature it on their profile).
      </p>
      <FeedbackForm token={token} coaches={coaches} defaultCoachId={data.coachId} defaultName={person ? `${person.firstName} ${person.lastName}` : ""} />
    </div>
  );
}
