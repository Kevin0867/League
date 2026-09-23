import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { formatSessionDay, formatTime12, phoenixDateInput } from "@/lib/time";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subs" };

// One place to see every single-session substitute (a drop-in covering a player
// for one practice) across all teams — who they are, which practice, waiver
// status, and how they got in — with the same Move / Remove actions that live on
// each session page. Player subs are SessionSub rows (a plain tag: no relations),
// distinct from a coach who substitutes a class (that's a SessionCoach).

export default async function SubsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "manageTeams")) redirect("/console");
  const ticket = await mintConsoleTicket();

  const returnTo = "/console/subs";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayStr = phoenixDateInput(new Date());

  // Upcoming, non-cancelled practices/matches — the sessions a sub can be on, and
  // the destinations for a "move".
  const upcomingSessions = await prisma.session.findMany({
    where: { type: { in: ["PRACTICE", "LEAGUE_MATCH"] }, status: { in: ["SCHEDULED", "RESCHEDULED"] }, date: { gte: startOfToday } },
    select: { id: true, date: true, startTime: true, teams: { select: { teamId: true, team: { select: { name: true, isTest: true } } } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  const sessionById = new Map(upcomingSessions.map((s) => [s.id, s]));
  // Move targets per team (this team's other upcoming sessions).
  const targetsByTeam = new Map<string, { id: string; date: Date; startTime: string }[]>();
  for (const s of upcomingSessions) {
    for (const t of s.teams) {
      const arr = targetsByTeam.get(t.teamId) ?? [];
      arr.push({ id: s.id, date: s.date, startTime: s.startTime });
      targetsByTeam.set(t.teamId, arr);
    }
  }

  const sessionIds = upcomingSessions.map((s) => s.id);
  const subs = sessionIds.length
    ? await prisma.sessionSub.findMany({ where: { sessionId: { in: sessionIds } }, orderBy: { createdAt: "asc" } })
    : [];

  const personIds = [...new Set(subs.map((x) => x.personId))];
  const people = personIds.length
    ? await prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, firstName: true, lastName: true, email: true, phone: true, waiverSignedAt: true } })
    : [];
  const personById = new Map(people.map((p) => [p.id, p]));

  // Rows sorted by practice date, then team.
  type Row = (typeof subs)[number] & { sessionDate: Date; startTime: string; teamName: string; isTest: boolean };
  const rows: Row[] = subs
    .map((x) => {
      const s = sessionById.get(x.sessionId);
      const teamOnSession = s?.teams.find((t) => t.teamId === x.teamId) ?? s?.teams[0];
      return s
        ? { ...x, sessionDate: s.date, startTime: s.startTime, teamName: teamOnSession?.team.name ?? "Team", isTest: teamOnSession?.team.isTest ?? false }
        : null;
    })
    .filter((r): r is Row => !!r && !r.isTest)
    .sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime() || a.startTime.localeCompare(b.startTime) || a.teamName.localeCompare(b.teamName));

  const pendingWaiver = rows.filter((r) => !personById.get(r.personId)?.waiverSignedAt).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/console/schedule" className="btn-back">← Schedule</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Session subs</h1>
        <p className="text-sm text-slate-500">
          Drop-in players covering a single practice — claimed on the open-spots page or added by staff. Move a sub to another of that team&apos;s practices, or remove them to release the spot back onto the website.
        </p>
      </div>

      {sp.ok === "subremoved" && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Sub removed — their spot is back on the open-spots page for someone else to claim.</div>}
      {sp.ok === "submoved" && <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Sub moved to the other practice — they&apos;ve been notified of the new date.</div>}
      {sp.err && <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">Couldn&apos;t complete that — {sp.err === "movedest" ? "that practice isn't available to move the sub to." : sp.err === "movefailed" ? "please try again." : "please try again."}</div>}

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-800">{rows.length} upcoming {rows.length === 1 ? "sub" : "subs"}</span>
          {pendingWaiver > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{pendingWaiver} waiver{pendingWaiver === 1 ? "" : "s"} pending</span>}
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No subs on any upcoming practice right now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-2 py-1.5 font-medium">Sub</th>
                  <th className="px-2 py-1.5 font-medium">Team</th>
                  <th className="px-2 py-1.5 font-medium">Practice</th>
                  <th className="px-2 py-1.5 font-medium">Waiver</th>
                  <th className="px-2 py-1.5 font-medium">Source</th>
                  <th className="px-2 py-1.5 text-right font-medium">Move / Remove</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const info = personById.get(r.personId);
                  const name = info ? `${info.firstName} ${info.lastName}`.trim() : "Sub";
                  const contact = [info?.email, info?.phone].filter(Boolean).join(" · ");
                  const waiverDone = !!info?.waiverSignedAt;
                  const targets = (targetsByTeam.get(r.teamId) ?? []).filter((t) => t.id !== r.sessionId && phoenixDateInput(t.date) >= todayStr);
                  return (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0 align-top">
                      <td className="px-2 py-2">
                        <Link href={`/console/people/${r.personId}`} className="font-medium text-brand-700 hover:underline">{name}</Link>
                        {contact && <div className="text-xs text-slate-400">{contact}</div>}
                      </td>
                      <td className="px-2 py-2 text-slate-600">{r.teamName}</td>
                      <td className="px-2 py-2 text-slate-600">
                        <Link href={`/console/schedule/${r.sessionId}`} className="hover:text-brand-700 hover:underline">
                          {formatSessionDay(r.sessionDate, "short")} · {formatTime12(r.startTime)}
                        </Link>
                      </td>
                      <td className="px-2 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${waiverDone ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{waiverDone ? "signed" : "pending"}</span>
                      </td>
                      <td className="px-2 py-2 text-[11px] uppercase tracking-wide text-slate-400">{r.addedByUserId ? "staff" : "online"}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {targets.length > 0 && (
                            <form method="POST" action="/api/team-calendar" className="flex items-center gap-1">
                              <input type="hidden" name="ticket" value={ticket} />
                              <input type="hidden" name="op" value="moveSub" />
                              <input type="hidden" name="teamId" value={r.teamId} />
                              <input type="hidden" name="sessionId" value={r.sessionId} />
                              <input type="hidden" name="personId" value={r.personId} />
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <select name="toSessionId" required defaultValue="" className="input w-auto py-1 text-xs">
                                <option value="" disabled>Move to…</option>
                                {targets.map((t) => (
                                  <option key={t.id} value={t.id}>{formatSessionDay(t.date, "short")} · {formatTime12(t.startTime)}</option>
                                ))}
                              </select>
                              <button className="btn-secondary text-xs">Move</button>
                            </form>
                          )}
                          <ConfirmSubmit
                            action="/api/team-calendar"
                            fields={{ ticket, op: "removeSub", teamId: r.teamId, sessionId: r.sessionId, personId: r.personId, returnTo }}
                            label="Remove"
                            confirm={`Remove ${name} from this practice? Their spot goes back on the open-spots page for someone else to claim, and they'll be told it was released.`}
                            className="btn-chip-danger"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">
        To ADD a sub, open a practice from the Schedule and use its Substitutes section (or players claim an open spot on the public open-spots page). Editing a sub&apos;s own details (name, contact, waiver) is on their record — click their name.
      </p>
    </div>
  );
}
