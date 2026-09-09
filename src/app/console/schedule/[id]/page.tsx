import { DateField } from "@/components/DateField";
import { TimeSelect } from "@/components/TimeSelect";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { StatusBadge } from "@/components/StatusBadge";
import { CANCEL_REASON } from "@/lib/enums";
import { cancellationOutcome } from "@/lib/domain/schedule";
import { formatTimeRange12, formatDate, formatSessionDay, formatTime12, phoenixDateInput } from "@/lib/time";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { TeamUpdateComposer } from "@/components/TeamUpdateComposer";
import { AttendanceMarker } from "@/components/AttendanceMarker";
import { decryptField } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session" };

const TYPE_LABEL: Record<string, string> = {
  PRACTICE: "Practice", LEAGUE_MATCH: "League match", CHAMPIONSHIP: "Championship", ALA_CARTE: "Private Lessons",
};

const OK_LABEL: Record<string, string> = {
  cancel: "Session cancelled.",
  relocate: "Session relocated.",
  attendance: "Attendance saved.",
  edited: "Session updated.",
  subAdded: "Coach added to this class.",
  subRemoved: "Coach removed from this class.",
  cancelrequested: "Cancellation request sent to the admins.",
};

const ERR_LABEL: Record<string, string> = {
  auth: "You are not authorized to perform that action.",
  session: "Session not found.",
  facility: "Choose a facility to relocate to.",
  coachgate: "That coach isn't cleared to be assigned (background check required).",
  subclash: "That coach already covers another class at this time. Use “add anyway” to override.",
  op: "Unknown action.",
};

const COACH_ROLE_LABEL: Record<string, string> = {
  PRIMARY: "Primary", ASSISTANT: "Assistant", SUBSTITUTE: "Substitute", BACKUP: "Backup",
};

export default async function SessionDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const { ok, err, srok, srerr } = await searchParams;
  const ticket = await mintConsoleTicket();
  const returnTo = `/console/schedule/${id}`;
  const s = await prisma.session.findUnique({
    where: { id },
    include: {
      facility: true,
      teams: { include: { team: { include: { members: { include: { person: { include: { guardian: true } } } }, assistantCoaches: { select: { coachId: true } } } } } },
      coaches: true,
      attendance: true,
    },
  });
  if (!s) notFound();

  const facilities = await prisma.facility.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const allCoaches = await prisma.coach.findMany({ include: { person: true }, orderBy: { person: { lastName: "asc" } } });
  const coachName = new Map(allCoaches.map((c) => [c.id, `${c.person.firstName} ${c.person.lastName}`]));
  const sessionCoachIds = new Set(s.coaches.map((c) => c.coachId));

  // Admins manage any session; a coach may open only sessions they cover (as the
  // session coach or a session team's head coach) and sees attendance only —
  // reschedule / relocate / cancel / delete / coach-staffing stay admin-only.
  const viewer = await getSession();
  const admin = isAdmin(viewer ? (viewer.roles ?? [viewer.role]) : []);
  const myCoachId = viewer?.personId
    ? (await prisma.coach.findUnique({ where: { personId: viewer.personId }, select: { id: true } }))?.id ?? null
    : null;
  if (!admin) {
    const onSession = !!myCoachId && (
      sessionCoachIds.has(myCoachId) ||
      s.teams.some((t) => t.team.coachId === myCoachId || t.team.assistantCoaches.some((ac) => ac.coachId === myCoachId))
    );
    if (!onSession) redirect("/console");
  }
  // If the viewer is covering this class as a substitute/backup, note it so they
  // know check-in records the session toward their pay.
  const myRole = myCoachId ? s.coaches.find((c) => c.coachId === myCoachId)?.role ?? null : null;
  const coveringSub = !admin && (myRole === "SUBSTITUTE" || myRole === "BACKUP");
  // The team's own head/assistant coach can add/modify practices (admins are
  // alerted). A sub covering the class can't reschedule it.
  const isTeamCoachHere = !!myCoachId && s.teams.some((t) => t.team.coachId === myCoachId || t.team.assistantCoaches.some((ac) => ac.coachId === myCoachId));
  const coachCanEdit = !admin && isTeamCoachHere && s.type === "PRACTICE";

  // Multi-team check-in: a coach's OTHER classes to check in — today's, plus any
  // recent past practice still un-recorded — so they hop team → team without
  // leaving the check-in flow. Excludes this session.
  let otherClasses: { id: string; name: string; startTime: string; isToday: boolean; done: boolean }[] = [];
  if (myCoachId) {
    const myTeams = await prisma.team.findMany({
      where: { OR: [{ coachId: myCoachId }, { assistantCoaches: { some: { coachId: myCoachId } } }] },
      select: { id: true },
    });
    const myTeamIds = myTeams.map((t) => t.id);
    if (myTeamIds.length) {
      const todayStr = phoenixDateInput(new Date());
      const from = new Date(Date.now() - 21 * 86400000);
      const rows = await prisma.session.findMany({
        where: { id: { not: id }, teams: { some: { teamId: { in: myTeamIds } } }, type: "PRACTICE", status: { in: ["SCHEDULED", "DELIVERED", "RESCHEDULED"] }, date: { gte: from } },
        orderBy: { date: "asc" },
        include: { _count: { select: { attendance: true } }, teams: { include: { team: { select: { name: true } } } } },
      });
      otherClasses = rows
        .filter((x) => {
          const day = phoenixDateInput(x.date);
          return day === todayStr || (day < todayStr && x.status === "SCHEDULED" && x._count.attendance === 0);
        })
        .map((x) => ({
          id: x.id,
          name: x.teams.map((t) => t.team.name).join(", ") || "Class",
          startTime: x.startTime,
          isToday: phoenixDateInput(x.date) === todayStr,
          done: x._count.attendance > 0,
        }));
    }
  }

  // Active sub request for this class (if any) — drives the "Need a sub?" card.
  // Query regardless of session status so an open request stays approvable and
  // cancellable even if the class was marked delivered (F-05).
  const activeSub = await prisma.subRequest.findFirst({ where: { sessionId: id, status: { in: ["OPEN", "PENDING"] } }, select: { id: true, note: true, status: true, requestedByCoachId: true, claimedByCoachId: true } });
  const subOfferName = activeSub?.claimedByCoachId
    ? (await prisma.coach.findUnique({ where: { id: activeSub.claimedByCoachId }, select: { person: { select: { firstName: true, lastName: true } } } }))
    : null;
  const offerName = subOfferName ? `${subOfferName.person.firstName} ${subOfferName.person.lastName}` : null;
  const canRequestSub = (admin || !!myCoachId) && s.status === "SCHEDULED";
  const SR_OK: Record<string, string> = {
    requested: "Sub requested — coaches and admins have been texted, and it's posted in the Coaches' Lounge.",
    already: "There's already an open sub request for this class.",
    offered: "Thanks — your offer to cover was sent to admins for approval.",
    approved: "Approved — the sub is covering this class now.",
    declined: "Offer declined — the request is open again.",
    cancelled: "Sub request cancelled.",
  };
  const SR_ERR: Record<string, string> = {
    auth: "Only an admin can approve a sub.",
    notfound: "That class or request is gone.",
    clash: "That overlaps another class you cover — can't offer it.",
    taken: "That request is no longer open.",
    pending: "That request already has an offer awaiting approval.",
    notpending: "That offer isn't awaiting approval anymore.",
    self: "You can't cover your own request.",
    notcoach: "Only a coach can cover a class.",
    nocoach: "No coach on this class to request for.",
  };

  // The coach(es) who'd earn this class — asked about on cancellation, since a
  // cancelled class doesn't pay by default.
  const payableCoaches = s.coaches.filter((c) => c.payable);
  const attMap = new Map(s.attendance.map((a) => [a.personId, a.status]));
  // Per-player safety card — emergency contacts, medical notes, and who to call —
  // decrypted for this authorized coach so it's one tap away from the roster on
  // the screen that's open when something goes wrong. `noAdult` warns when a minor
  // has no guardian and no emergency contact on file: no one to call.
  const roster = s.teams.flatMap((t) =>
    t.team.members.map((m) => {
      const p = m.person;
      const g = p.guardian;
      const emergency = [
        { name: decryptField(p.emergencyName), relation: decryptField(p.emergencyRelation), phone: decryptField(p.emergencyPhone) },
        { name: decryptField(p.emergencyName2), relation: decryptField(p.emergencyRelation2), phone: decryptField(p.emergencyPhone2) },
      ].filter((e) => e.name || e.phone);
      const guardianName = g ? `${g.firstName} ${g.lastName}`.trim() : null;
      const guardianPhone = g?.phone ?? null;
      const medical = decryptField(p.medicalNotes);
      const noAdult = p.isMinor && !guardianPhone && emergency.length === 0;
      return { ...m, teamName: t.team.name, emergency, guardianName, guardianPhone, medical, noAdult };
    }),
  );
  const active = s.status === "SCHEDULED" || s.status === "DELIVERED";
  const outcome = cancellationOutcome(s.type);

  return (
    <div className="space-y-6">
      <div>
        <Link href={admin ? "/console/schedule" : "/console"} className="btn-back">← {admin ? "Schedule" : "Home"}</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">
            {TYPE_LABEL[s.type] ?? s.type} · {formatSessionDay(s.date, "long")}
          </h1>
          <StatusBadge status={s.status} />
        </div>
        <p className="text-sm text-slate-500">
          {s.teams.map((t) => t.team.name).join(", ")} · {s.facility?.name ?? "no facility"} · {formatTimeRange12(s.startTime, s.endTime)}
          {s.weekNumber ? ` · week ${s.weekNumber}` : ""}
        </p>
        {s.cancelReason && (
          <p className="mt-1 text-sm text-rose-600">Reason: {s.cancelReason.toLowerCase().replace(/_/g, " ")}</p>
        )}
        {/* Everything a coach does around a class in one place: check players in
            below, and jump to notes + a team message (homework) per team. */}
        {s.teams.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {s.teams.map((t) => (
              <Link
                key={t.teamId}
                href={`/console/teams/${t.teamId}/progress`}
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-slate-50"
              >
                Notes &amp; team message · {t.team.name} →
              </Link>
            ))}
          </div>
        )}
      </div>

      {coveringSub && (
        <div className="rounded-lg border-l-4 border-brand-400 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          You&apos;re covering this class as a {myRole === "BACKUP" ? "backup" : "substitute"} coach — check players in and add notes for the team below.
          {myRole === "SUBSTITUTE" && " This session’s pay is yours, not the normal coach’s."} It’s credited to you automatically once the class time is over — no check-out needed.
        </div>
      )}
      {ok && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{OK_LABEL[ok] ?? "Done."}</div>
      )}
      {err && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{ERR_LABEL[err] ?? "Something went wrong."}</div>
      )}
      {srok && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{SR_OK[srok] ?? "Done."}</div>}
      {srerr && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{SR_ERR[srerr] ?? "Something went wrong."}</div>}

      {/* Need a sub? — the coach who can't make this class asks for cover here;
          other coaches claim it from the Coaches' Lounge. */}
      {(canRequestSub || activeSub) && (
        <div className="card border-l-4 border-amber-400">
          {activeSub ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {activeSub.status === "PENDING" ? (
                  <>
                    <h2 className="font-semibold text-slate-900">{offerName ?? "A coach"} offered to cover — needs admin approval</h2>
                    <p className="mt-0.5 text-sm text-slate-500">An admin approves before it&apos;s put in place. {admin ? "Approve or decline below." : "You'll be texted when it's approved."}</p>
                  </>
                ) : (
                  <>
                    <h2 className="font-semibold text-slate-900">Sub requested — waiting for a coach to offer</h2>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Coaches and admins were texted, and it&apos;s in the Coaches&apos; Lounge.{activeSub.note ? <> Note: “{activeSub.note}”.</> : null}
                    </p>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeSub.status === "PENDING" && admin && (
                  <>
                    <form method="POST" action="/api/console/sub-requests">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="approve" />
                      <input type="hidden" name="requestId" value={activeSub.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Approve {offerName ?? "coach"}</button>
                    </form>
                    <form method="POST" action="/api/console/sub-requests">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="decline" />
                      <input type="hidden" name="requestId" value={activeSub.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button className="text-sm text-rose-600 hover:underline">Deny</button>
                    </form>
                  </>
                )}
                {(admin || activeSub.requestedByCoachId === myCoachId) && (
                  <form method="POST" action="/api/console/sub-requests">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value="cancel" />
                    <input type="hidden" name="requestId" value={activeSub.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button className="btn-ghost text-sm">Cancel request</button>
                  </form>
                )}
              </div>
              {/* Choose another coach — admins can approve someone other than the
                  volunteer (or assign directly on an OPEN request). */}
              {admin && (
                <form method="POST" action="/api/console/sub-requests" className="mt-3 flex w-full flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <input type="hidden" name="ticket" value={ticket} />
                  <input type="hidden" name="op" value="assignOther" />
                  <input type="hidden" name="requestId" value={activeSub.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <label className="text-sm text-slate-600">Or assign a different coach:</label>
                  <select name="coachId" required className="input w-auto py-1 text-sm">
                    <option value="">— choose coach —</option>
                    {allCoaches.map((c) => <option key={c.id} value={c.id}>{c.person.firstName} {c.person.lastName}</option>)}
                  </select>
                  <button className="btn-secondary text-sm">Assign &amp; approve</button>
                </form>
              )}
            </div>
          ) : (
            <details>
              <summary className="cursor-pointer font-semibold text-slate-900">Can&apos;t make this class? Request a sub</summary>
              <p className="mt-1 text-sm text-slate-500">Texts every coach and admin and posts it to the Coaches&apos; Lounge, where another coach offers to cover it. An admin approves before it&apos;s put in place; whoever covers is paid for the class.</p>
              <form method="POST" action="/api/console/sub-requests" className="mt-3 space-y-2">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="request" />
                <input type="hidden" name="sessionId" value={s.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <textarea name="note" rows={2} maxLength={500} placeholder="Optional — e.g. running late, out sick, family thing." className="input w-full" />
                <div className="flex justify-end">
                  <button className="btn-primary text-sm">Request a sub</button>
                </div>
              </form>
            </details>
          )}
        </div>
      )}

      {/* Multi-team coaches: jump straight to another class to check in without
          going back out. Today's classes first, then any still needing attendance. */}
      {otherClasses.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Your other classes to check in</div>
          <div className="flex flex-wrap gap-2">
            {otherClasses.map((c) => (
              <a key={c.id} href={`/console/schedule/${c.id}#attendance`} className="btn-link text-xs">
                {c.name} · {formatTime12(c.startTime)}{c.isToday ? "" : " (past)"}{c.done ? " ✓" : ""}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Attendance — mobile-first, self-saving (§18) */}
        <AttendanceMarker
          ticket={ticket}
          sessionId={s.id}
          players={roster.map((m) => ({
            personId: m.personId,
            name: `${m.person.firstName} ${m.person.lastName}`,
            status: attMap.get(m.personId) ?? "",
            emergency: m.emergency,
            guardianName: m.guardianName,
            guardianPhone: m.guardianPhone,
            medical: m.medical,
            noAdult: m.noAdult,
          }))}
        />

        {/* After check-in — the clear fork: leave notes/feedback, message the
            team, or move on to the next class. Coaches can go back and forth. */}
        {s.teams.length > 0 && s.status !== "CANCELLED" && (
          <div className="card border-l-4 border-brand-400 lg:col-span-2">
            <h2 className="font-semibold text-slate-900">Checked in? Here&apos;s what&apos;s next</h2>
            <p className="mt-0.5 text-sm text-slate-500">Leave notes or player feedback, send a recap, or move to your next class — in any order.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {s.teams.map((t) => (
                <a key={t.teamId} href={`/console/teams/${t.teamId}/progress#notes`} className="btn-link">
                  Notes &amp; player feedback{s.teams.length > 1 ? ` · ${t.team.name}` : ""} →
                </a>
              ))}
              <a href="#recap" className="btn-link">Message the team ↓</a>
              {otherClasses.length > 0 && (
                <a href={`/console/schedule/${otherClasses[0].id}#attendance`} className="btn-primary text-sm">
                  Next class: {otherClasses[0].name} →
                </a>
              )}
            </div>
          </div>
        )}

        {/* Practice recap — a one-tap note to the whole team (players + parents)
            about tonight's practice: what you worked on + homework before next
            time. One composer per team on the session. */}
        {s.teams.length > 0 && s.status !== "CANCELLED" && (
          <div id="recap" className="lg:col-span-2 space-y-3 scroll-mt-4">
            {s.teams.map((t) => (
              <div key={t.teamId} className="card">
                <h2 className="font-semibold text-slate-900">Message {s.teams.length > 1 ? t.team.name : "the team"} about this practice</h2>
                <p className="mb-3 mt-0.5 text-sm text-slate-500">A quick recap to every player &amp; parent — what you worked on tonight and what to practice before next time.</p>
                <TeamUpdateComposer
                  ticket={ticket}
                  teamId={t.teamId}
                  teamName={t.team.name}
                  placeholder={"e.g. Great practice tonight! We worked on serves, returns, and dinking. Before next practice, please have your player work on their third-shot drop and footwork."}
                  submitLabel="Send recap to team"
                />
              </div>
            ))}
          </div>
        )}

        {/* Coach-editable practice controls — the team's own coach can reschedule
            or remove this practice; admins are alerted automatically. */}
        {coachCanEdit && (
          <div className="space-y-4">
            <form method="POST" action="/api/console/schedule" className="card">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="editSession" />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="sessionId" value={s.id} />
              <h2 className="mb-1 font-semibold text-slate-900">Reschedule practice</h2>
              <p className="mb-3 text-xs text-slate-500">Change the date, time, or place. Admins are notified of the change.</p>
              <div className="space-y-3">
                <div>
                  <label className="label">Date</label>
                  <DateField name="date" className="input" defaultValue={s.date.toISOString().slice(0, 10)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Start</label><TimeSelect name="startTime" className="input" defaultValue={s.startTime} /></div>
                  <div><label className="label">End</label><TimeSelect name="endTime" className="input" defaultValue={s.endTime} /></div>
                </div>
                <div>
                  <label className="label">Facility</label>
                  <select name="facilityId" className="input" defaultValue={s.facilityId ?? ""}>
                    <option value="">— none —</option>
                    {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="notify" value="1" defaultChecked />
                  Notify the team of the change
                </label>
                <button className="btn-primary w-full">Save changes</button>
              </div>
            </form>
            <div className="card border border-amber-200">
              <h2 className="mb-1 font-semibold text-slate-900">Need this class called off?</h2>
              <p className="mb-3 text-xs text-slate-500">Only an admin can cancel a class, so families get proper notice. Send them a heads-up and they&apos;ll take it from there.</p>
              <form method="POST" action="/api/console/schedule" className="space-y-2">
                <input type="hidden" name="ticket" value={ticket} />
                <input type="hidden" name="op" value="requestCancel" />
                <input type="hidden" name="sessionId" value={s.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <textarea name="reason" rows={2} maxLength={300} placeholder="Optional — why (weather, facility, etc.)" className="input w-full" />
                <button className="btn-secondary w-full text-sm">Request cancellation</button>
              </form>
            </div>
          </div>
        )}

        {/* Session controls — admin only. Coaches record attendance (left). */}
        {admin && (
        <div className="space-y-4">
          {/* Coaching — primary + add a substitute/backup for this one class */}
          <div className="card">
            <h2 className="mb-2 font-semibold text-slate-900">Coaching</h2>
            {s.coaches.length === 0 ? (
              <p className="mb-3 text-sm text-slate-400">No coach on this class yet.</p>
            ) : (
              <ul className="mb-3 space-y-2">
                {s.coaches.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm ring-1 ring-slate-100">
                    <span className="text-slate-700">{coachName.get(c.coachId) ?? "Unknown coach"}</span>
                    <span className="flex items-center gap-2">
                      <span className={`badge ${c.role === "PRIMARY" ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600"}`}>
                        {COACH_ROLE_LABEL[c.role] ?? c.role}
                      </span>
                      {c.role !== "PRIMARY" && (
                        <form method="POST" action="/api/console/schedule">
                          <input type="hidden" name="ticket" value={ticket} />
                          <input type="hidden" name="op" value="removeSessionCoach" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="sessionId" value={s.id} />
                          <input type="hidden" name="coachId" value={c.coachId} />
                          <button className="text-xs text-rose-600 hover:underline">Remove</button>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form method="POST" action="/api/console/schedule" className="space-y-2">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="assignSubstitute" />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="sessionId" value={s.id} />
              <label className="label">Add a substitute / backup for this class</label>
              <select name="coachId" className="input" required>
                <option value="">— choose coach —</option>
                {allCoaches
                  .filter((c) => !sessionCoachIds.has(c.id))
                  .map((c) => <option key={c.id} value={c.id}>{c.person.firstName} {c.person.lastName}</option>)}
              </select>
              <select name="role" className="input">
                <option value="SUBSTITUTE">Substitute</option>
                <option value="BACKUP">Backup</option>
                <option value="ASSISTANT">Assistant</option>
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" name="force" value="1" />
                Add even if it overlaps another class they cover
              </label>
              <button className="btn-secondary w-full text-sm">Add coach to this class</button>
            </form>
          </div>

          {/* Reschedule — date, time, facility */}
          <form method="POST" action="/api/console/schedule" className="card">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="editSession" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="sessionId" value={s.id} />
            <h2 className="mb-3 font-semibold text-slate-900">Reschedule</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Date</label>
                <DateField name="date" className="input" defaultValue={s.date.toISOString().slice(0, 10)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Start</label><TimeSelect name="startTime" className="input" defaultValue={s.startTime} /></div>
                <div><label className="label">End</label><TimeSelect name="endTime" className="input" defaultValue={s.endTime} /></div>
              </div>
              <div>
                <label className="label">Facility</label>
                <select name="facilityId" className="input" defaultValue={s.facilityId ?? ""}>
                  <option value="">— none —</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" name="notify" value="1" defaultChecked />
                Notify the team of the change
              </label>
              <button className="btn-primary w-full">Save changes</button>
            </div>
          </form>

          {active && (
            <form method="POST" action="/api/console/schedule" className="card">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="cancel" />
              <input type="hidden" name="returnTo" value={returnTo} />
              <h2 className="mb-2 font-semibold text-slate-900">Cancel session</h2>
              <p className="mb-3 text-xs text-slate-500">{outcome.note}</p>
              <label className="label" htmlFor="reason">Reason</label>
              <select id="reason" name="reason" className="input">
                {CANCEL_REASON.map((r) => <option key={r} value={r}>{r[0] + r.slice(1).toLowerCase().replace(/_/g, " ")}</option>)}
              </select>
              <input type="hidden" name="sessionId" value={s.id} />

              {/* Pay-on-cancel — a cancelled class isn't paid by default. Ask per
                  coach so a late cancellation the coach showed up for can still pay. */}
              {payableCoaches.length > 0 && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-600">
                    A cancelled class isn&apos;t paid by default. Pay the coach for this class anyway?
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {payableCoaches.map((c) => (
                      <label key={c.coachId} className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" name="payCoach" value={c.coachId} className="h-4 w-4" />
                        Pay {coachName.get(c.coachId) ?? "this coach"} for this class
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <button className="btn-secondary mt-3 w-full text-rose-700 ring-rose-200 hover:bg-rose-50">
                {s.type === "PRACTICE" ? "Cancel practice" : "Cancel & reschedule"}
              </button>
            </form>
          )}

          <form method="POST" action="/api/console/schedule" className="card">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="relocate" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <h2 className="mb-2 font-semibold text-slate-900">Relocate</h2>
            <p className="mb-3 text-xs text-slate-500">Move to an indoor/alternative court to preserve the session as delivered.</p>
            <input type="hidden" name="sessionId" value={s.id} />
            <select name="facilityId" className="input" defaultValue={s.relocatedFacilityId ?? ""}>
              <option value="">— choose facility —</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="notify" value="1" defaultChecked />
              Notify the team of the new location
            </label>
            <button className="btn-ghost mt-3 w-full">Relocate session</button>
          </form>

          {/* Delete — for a session created by mistake. Cancel (above) notifies
              the team; delete just removes it quietly. */}
          <div className="card border border-rose-200">
            <h2 className="mb-1 font-semibold text-rose-700">Delete session</h2>
            <p className="mb-3 text-xs text-slate-500">Removes this {s.type.toLowerCase()} entirely — no notice to the team. Use Cancel instead if the team should be told. This can&apos;t be undone.</p>
            <ConfirmSubmit
              action="/api/console/schedule"
              fields={{ ticket, op: "deleteSession", sessionId: s.id, returnTo: "/console/schedule" }}
              label="Delete session"
              confirm={`Delete this ${s.type.toLowerCase()} on ${formatDate(s.date)}? The team is not notified. This can't be undone.`}
              className="w-full rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
