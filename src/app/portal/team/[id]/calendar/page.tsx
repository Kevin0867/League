import Link from "next/link";
import { requireUser, isAdmin } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { formatSessionDay, formatTime12, phoenixDateInput } from "@/lib/time";
import { listTeamCalendar, teamDescription } from "@/lib/domain/teamCalendar";
import { coachedTeamIdsForUser } from "@/lib/domain/coachingAccess";
import { Notice } from "@/components/Notice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Calendar" };

export default async function TeamCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { id: teamId } = await params;
  const sp = await searchParams;
  const session = await requireUser();
  const me = session.personId
    ? await prisma.person.findUnique({ where: { id: session.personId }, include: { dependents: { select: { id: true, firstName: true, lastName: true } } } })
    : null;
  const household = me ? [me.id, ...me.dependents.map((d) => d.id)] : [];

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { division: { select: { name: true } }, facility: { select: { name: true } } },
  });
  const myMembers = team ? await prisma.teamMember.findMany({ where: { teamId, personId: { in: household } }, select: { personId: true } }) : [];
  // Coaches of the team and admins can preview the player calendar (they aren't
  // rostered players, so they don't see a personal "I can't make it" button).
  const staffPreview = isAdmin(session.roles ?? [session.role]) || (await coachedTeamIdsForUser(session.userId)).includes(teamId);
  if (!team || (myMembers.length === 0 && !staffPreview)) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-xl font-bold text-slate-900">Team not found</h1>
        <p className="mt-2 text-slate-500">This team isn&apos;t on your account.</p>
        <Link href="/portal" className="btn-primary mt-6">Back to my portal</Link>
      </div>
    );
  }
  const memberIds = new Set(myMembers.map((m) => m.personId));
  const memberList = me ? [me, ...me.dependents].filter((p) => memberIds.has(p.id)) : [];
  const ticket = await mintConsoleTicket();
  const sessions = await listTeamCalendar(teamId, household);

  const today = phoenixDateInput(new Date());
  const upcoming = sessions.filter((s) => phoenixDateInput(s.date) >= today);
  const past = sessions.filter((s) => phoenixDateInput(s.date) < today);

  const returnTo = `/portal/team/${teamId}/calendar`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{teamDescription(team)}</p>
          <h1 className="text-2xl font-bold text-slate-900">{team.name} — calendar</h1>
          <p className="mt-0.5 text-sm text-slate-500">Practices and events. Can&apos;t make a practice? Mark it below so we can line up a sub.</p>
        </div>
        <Link href={`/portal/team/${teamId}`} className="btn-ghost text-sm">← Team</Link>
      </div>

      {staffPreview && memberList.length === 0 && (
        <Notice kind="info" title="Preview — this is what players see">Players on this team see a <strong>&ldquo;I can&apos;t make this practice&rdquo;</strong> button on each practice below. You&apos;re viewing as staff, so you don&apos;t have a personal button here.</Notice>
      )}
      {sp.ok === "absent" && <Notice kind="success" title="Thanks for the heads-up">Your team, coach, and the office have been notified that a sub is needed.</Notice>}
      {sp.ok === "present" && <Notice kind="success" title="You&apos;re back in">We&apos;ve marked you as attending again.</Notice>}
      {sp.ok === "suggested" && <Notice kind="success" title="Sub suggested">Thanks! Your coach will review and add them.</Notice>}
      {sp.err === "subfields" && <Notice kind="error" title="Add their details">A sub needs a name and an email or mobile number.</Notice>}
      {sp.err && sp.err !== "subfields" && <Notice kind="error" title="Something went wrong">Please try again.</Notice>}

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-400">No upcoming sessions scheduled yet.</p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((s) => (
              <li key={s.id} id={`s-${s.id}`} className="rounded-xl border border-slate-200 p-3 scroll-mt-20">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{s.title} · {formatSessionDay(s.date, "long")}</div>
                    <div className="text-sm text-slate-500">{formatTime12(s.startTime)}{s.endTime ? `–${formatTime12(s.endTime)}` : ""}{s.facilityName ? ` · ${s.facilityName}` : ""}</div>
                    {s.address && <div className="text-xs text-slate-400">{s.address}</div>}
                  </div>
                  {s.openSpots > 0 && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      {s.openSpots} sub{s.openSpots === 1 ? "" : "s"} needed
                    </span>
                  )}
                </div>

                {s.type === "PRACTICE" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {s.iAmOut ? (
                      <form method="POST" action="/api/team-calendar">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="present" />
                        <input type="hidden" name="teamId" value={teamId} />
                        <input type="hidden" name="sessionId" value={s.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <span className="mr-1 text-sm font-medium text-amber-700">You&apos;re marked out.</span>
                        <button className="btn-secondary text-sm">I&apos;m back in</button>
                      </form>
                    ) : (
                      <form method="POST" action="/api/team-calendar" className="flex items-center gap-2">
                        <input type="hidden" name="ticket" value={ticket} />
                        <input type="hidden" name="op" value="absent" />
                        <input type="hidden" name="teamId" value={teamId} />
                        <input type="hidden" name="sessionId" value={s.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        {memberList.length > 1 && (
                          <select name="personId" className="input py-1 text-sm">
                            {memberList.map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                          </select>
                        )}
                        <button className="btn-secondary text-sm">I can&apos;t make this practice</button>
                      </form>
                    )}

                    {s.openSpots > 0 && (
                      <details className="w-full">
                        <summary className="cursor-pointer text-sm font-medium text-brand-700">Suggest a sub →</summary>
                        <form method="POST" action="/api/team-calendar" className="mt-2 grid gap-2 sm:grid-cols-3">
                          <input type="hidden" name="ticket" value={ticket} />
                          <input type="hidden" name="op" value="suggest" />
                          <input type="hidden" name="teamId" value={teamId} />
                          <input type="hidden" name="sessionId" value={s.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input name="name" placeholder="Sub's name" required className="input text-sm" />
                          <input name="email" type="email" placeholder="Email" className="input text-sm" />
                          <input name="phone" type="tel" placeholder="Mobile" className="input text-sm" />
                          <div className="sm:col-span-3 flex justify-end"><button className="btn-primary text-sm">Suggest this sub</button></div>
                        </form>
                      </details>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-500">Past sessions ({past.length})</summary>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {past.slice(-20).reverse().map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span className="text-slate-600">{s.title} · {formatSessionDay(s.date, "long")}</span>
                <span className="text-slate-400">{formatTime12(s.startTime)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
