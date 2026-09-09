import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { requireStaff } from "@/lib/rbac";
import { isAdmin } from "@/lib/rbac";
import { formatStamp, formatDate, formatTime12 } from "@/lib/time";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  posted: "Posted to the lounge.",
  replied: "Reply added.",
  pinned: "Pinned to the top.",
  unpinned: "Unpinned.",
  deleted: "Deleted.",
};
const ERR: Record<string, string> = {
  auth: "You don't have access to do that.",
  empty: "Write something first.",
  notfound: "That post is gone.",
};

const NOTIFY_LABEL: Record<string, string> = {
  NONE: "posted quietly",
  INAPP: "notified staff in-app",
  EMAIL: "emailed staff",
  TEXT: "texted staff",
};

export default async function LoungePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const admin = isAdmin(session.roles ?? [session.role]);
  const myPersonId = session.personId ?? null;

  const allPosts = await prisma.coachPost.findMany({
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: { replies: { orderBy: { createdAt: "asc" } } },
  });
  // Sub requests live in the red pinned board above — hide the old auto-posted
  // "Sub needed" feed cards (superseded) so the board is the single source.
  const posts = allPosts.filter((p) => !p.body.startsWith("🔁 Sub needed"));

  // Open sub requests — the "need a sub" board. Any coach can cover one.
  const myCoach = myPersonId ? await prisma.coach.findUnique({ where: { personId: myPersonId }, select: { id: true } }) : null;
  const myCoachId = myCoach?.id ?? null;
  const openReqs = await prisma.subRequest.findMany({
    where: { status: { in: ["OPEN", "PENDING"] }, session: { status: "SCHEDULED" } },
    orderBy: { createdAt: "asc" },
    include: { session: { include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } } } },
  });
  const coachIds = [...new Set(openReqs.flatMap((r) => [r.requestedByCoachId, r.claimedByCoachId].filter(Boolean) as string[]))];
  const coachRows = coachIds.length
    ? await prisma.coach.findMany({ where: { id: { in: coachIds } }, select: { id: true, person: { select: { firstName: true, lastName: true } } } })
    : [];
  const coachNameById = new Map(coachRows.map((c) => [c.id, `${c.person.firstName} ${c.person.lastName}`]));
  const SR_OK: Record<string, string> = {
    requested: "Sub requested — coaches and admins notified by text.",
    offered: "Thanks — your offer to cover was sent to admins for approval.",
    approved: "Approved — the sub is covering that class now.",
    declined: "Offer declined — the request is open again.",
    cancelled: "Sub request cancelled.",
    already: "There's already an open request for that class.",
  };
  const SR_ERR: Record<string, string> = {
    clash: "That overlaps another class you cover — can't offer it.",
    taken: "That request is no longer open.",
    pending: "That request already has an offer awaiting approval.",
    notpending: "That offer isn't awaiting approval anymore.",
    self: "You can't cover your own request.",
    notcoach: "Only a coach can cover a class.",
    auth: "Only an admin can approve a sub.",
    notfound: "That request is gone.",
  };

  const hidden = (
    <>
      <input type="hidden" name="ticket" value={ticket} />
    </>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Coaches' Lounge" subtitle="Staff only — banter, announcements, and asks (need a sub Thursday?). Players and parents never see this." />

      {sp.ok && OK[sp.ok] && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{OK[sp.ok]}</p>}
      {sp.err && ERR[sp.err] && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{ERR[sp.err]}</p>}
      {sp.srok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{SR_OK[sp.srok] ?? "Done."}</p>}
      {sp.srerr && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{SR_ERR[sp.srerr] ?? "Something went wrong."}</p>}

      {/* Sub requests board — pinned red at the top until each is picked up and
          approved, then it clears itself. Coaches offer to cover; admins approve. */}
      {openReqs.length > 0 && (
        <div className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-4 shadow-sm">
          <h2 className="flex items-center gap-2 font-bold text-rose-800">
            📌 Sub requests
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">{openReqs.length} need action</span>
          </h2>
          <p className="mt-0.5 text-sm text-rose-900/80">A coach needs cover. First coach to <strong>pick up the class</strong> is sent to admins to <strong>approve, deny, or assign someone else</strong>. Whoever&apos;s approved covers it and is paid — then it drops off here.</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {openReqs.map((r) => {
              const teams = r.session.teams.map((t) => t.team.name).join(", ") || "a class";
              const isMine = r.requestedByCoachId === myCoachId;
              const pending = r.status === "PENDING";
              const offerName = r.claimedByCoachId ? coachNameById.get(r.claimedByCoachId) ?? "a coach" : null;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="text-slate-700">
                    <span className="font-medium text-slate-800">{teams}</span> · {formatDate(r.session.date)} at {formatTime12(r.session.startTime)}
                    {r.session.facility ? ` · ${r.session.facility.name}` : ""}
                    <div className="text-xs text-slate-400">
                      asked by {coachNameById.get(r.requestedByCoachId) ?? "a coach"}{r.note ? ` — “${r.note}”` : ""}
                      {pending && offerName ? <> · <span className="font-medium text-amber-700">{offerName} offered — awaiting approval</span></> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {pending && admin && (
                      <>
                        <form method="POST" action="/api/console/sub-requests">
                          {hidden}
                          <input type="hidden" name="op" value="approve" />
                          <input type="hidden" name="requestId" value={r.id} />
                          <input type="hidden" name="returnTo" value="/console/lounge" />
                          <button className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Approve</button>
                        </form>
                        <form method="POST" action="/api/console/sub-requests">
                          {hidden}
                          <input type="hidden" name="op" value="decline" />
                          <input type="hidden" name="requestId" value={r.id} />
                          <input type="hidden" name="returnTo" value="/console/lounge" />
                          <button className="text-xs text-rose-600 hover:underline">Decline</button>
                        </form>
                      </>
                    )}
                    {pending && admin && (
                      <a href={`/console/schedule/${r.session.id}`} className="text-xs font-medium text-brand-600 hover:underline">Assign someone else →</a>
                    )}
                    {pending && !admin && <span className="text-xs text-amber-700">awaiting admin approval</span>}
                    {!pending && isMine && (
                      <form method="POST" action="/api/console/sub-requests">
                        {hidden}
                        <input type="hidden" name="op" value="cancel" />
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="returnTo" value="/console/lounge" />
                        <button className="text-xs text-slate-500 hover:underline">Your request · cancel</button>
                      </form>
                    )}
                    {!pending && !isMine && myCoachId && (
                      <form method="POST" action="/api/console/sub-requests">
                        {hidden}
                        <input type="hidden" name="op" value="claim" />
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="returnTo" value="/console/lounge" />
                        <button className="rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">Pick up this class →</button>
                      </form>
                    )}
                    {!pending && !isMine && !myCoachId && <span className="text-xs text-slate-400">coaches can cover</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Composer */}
      <div className="card">
        <form method="POST" action="/api/console/lounge" className="space-y-3">
          {hidden}
          <input type="hidden" name="op" value="post" />
          <textarea
            name="body"
            required
            rows={3}
            maxLength={4000}
            placeholder="Say something to the coaches… (banter, a heads-up, or 'need a sub for Mesa MID this Thursday')"
            className="input w-full"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="text-sm text-slate-600">
              Notify staff:{" "}
              <select name="notify" defaultValue="INAPP" className="input ml-1 inline-block w-auto py-1 text-sm">
                <option value="NONE">Just post (no ping)</option>
                <option value="INAPP">On the board + in-app</option>
                <option value="EMAIL">Email everyone</option>
                <option value="TEXT">Text everyone (important)</option>
              </select>
            </label>
            <div className="flex items-center gap-3">
              {admin && (
                <label className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input type="checkbox" name="pinned" className="accent-brand-600" /> Pin (announcement)
                </label>
              )}
              <button className="btn-accent text-sm">Post</button>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Text and email go to every coach and admin. Use them for real asks; keep the jokes on &ldquo;Just post&rdquo; or &ldquo;in-app.&rdquo;
          </p>
        </form>
      </div>

      {/* Feed */}
      {posts.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing here yet — break the ice.</p>
      ) : (
        <div className="space-y-4">
          {posts.map((p) => (
            <div key={p.id} className={`card ${p.pinned ? "border-l-4 border-amber-400" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-semibold text-slate-900">{p.authorName}</span>
                  {p.pinned && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">📌 Announcement</span>}
                  <div className="text-xs text-slate-400">{formatStamp(p.createdAt)} · {NOTIFY_LABEL[p.notify] ?? "posted"}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  {admin && (
                    <form method="POST" action="/api/console/lounge">
                      {hidden}
                      <input type="hidden" name="op" value={p.pinned ? "unpin" : "pin"} />
                      <input type="hidden" name="postId" value={p.id} />
                      <button className="font-medium text-brand-600 hover:underline">{p.pinned ? "unpin" : "pin"}</button>
                    </form>
                  )}
                  {(admin || p.authorPersonId === myPersonId) && (
                    <form method="POST" action="/api/console/lounge">
                      {hidden}
                      <input type="hidden" name="op" value="deletePost" />
                      <input type="hidden" name="postId" value={p.id} />
                      <button className="text-rose-600 hover:underline">delete</button>
                    </form>
                  )}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{p.body}</p>

              {/* Replies */}
              {p.replies.length > 0 && (
                <ul className="mt-3 space-y-2 border-l-2 border-slate-100 pl-3">
                  {p.replies.map((r) => (
                    <li key={r.id} className="text-sm">
                      <span className="font-medium text-slate-800">{r.authorName}</span>
                      <span className="ml-2 text-xs text-slate-400">{formatStamp(r.createdAt)}</span>
                      {(admin || r.authorPersonId === myPersonId) && (
                        <form method="POST" action="/api/console/lounge" className="ml-2 inline">
                          {hidden}
                          <input type="hidden" name="op" value="deleteReply" />
                          <input type="hidden" name="replyId" value={r.id} />
                          <button className="text-xs text-rose-500 hover:underline">×</button>
                        </form>
                      )}
                      <p className="whitespace-pre-wrap text-slate-600">{r.body}</p>
                    </li>
                  ))}
                </ul>
              )}

              {/* Reply box */}
              <form method="POST" action="/api/console/lounge" className="mt-3 flex items-center gap-2">
                {hidden}
                <input type="hidden" name="op" value="reply" />
                <input type="hidden" name="postId" value={p.id} />
                <input name="body" required maxLength={4000} placeholder="Reply…" className="input flex-1 py-1 text-sm" />
                <button className="btn-secondary py-1 text-xs">Reply</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
