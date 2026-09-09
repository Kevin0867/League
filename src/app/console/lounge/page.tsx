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

  const posts = await prisma.coachPost.findMany({
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: { replies: { orderBy: { createdAt: "asc" } } },
  });

  // Open sub requests — the "need a sub" board. Any coach can cover one.
  const myCoach = myPersonId ? await prisma.coach.findUnique({ where: { personId: myPersonId }, select: { id: true } }) : null;
  const myCoachId = myCoach?.id ?? null;
  const openReqs = await prisma.subRequest.findMany({
    where: { status: "OPEN", session: { status: "SCHEDULED" } },
    orderBy: { createdAt: "asc" },
    include: { session: { include: { facility: { select: { name: true } }, teams: { include: { team: { select: { name: true } } } } } } },
  });
  const reqCoachIds = [...new Set(openReqs.map((r) => r.requestedByCoachId))];
  const reqCoaches = reqCoachIds.length
    ? await prisma.coach.findMany({ where: { id: { in: reqCoachIds } }, select: { id: true, person: { select: { firstName: true, lastName: true } } } })
    : [];
  const reqNameById = new Map(reqCoaches.map((c) => [c.id, `${c.person.firstName} ${c.person.lastName}`]));
  const SR_OK: Record<string, string> = {
    requested: "Sub requested — coaches notified.",
    claimed: "You're covering that class — it's on your schedule now.",
    cancelled: "Sub request cancelled.",
    already: "There's already an open request for that class.",
  };
  const SR_ERR: Record<string, string> = {
    clash: "That overlaps another class you cover — can't claim it.",
    taken: "Someone already covered that one.",
    self: "You can't cover your own request.",
    notcoach: "Only a coach can cover a class.",
    auth: "Not allowed.",
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

      {/* Sub requests board — open "need a sub" asks any coach can cover. */}
      {openReqs.length > 0 && (
        <div className="card border-l-4 border-amber-400">
          <h2 className="font-semibold text-slate-900">🔁 Sub requests — {openReqs.length} open</h2>
          <p className="mt-0.5 text-sm text-slate-500">A coach needs cover. Tap <strong>Cover this class</strong> — it&apos;s added to your schedule and you&apos;re paid for it.</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {openReqs.map((r) => {
              const teams = r.session.teams.map((t) => t.team.name).join(", ") || "a class";
              const isMine = r.requestedByCoachId === myCoachId;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="text-slate-700">
                    <span className="font-medium text-slate-800">{teams}</span> · {formatDate(r.session.date)} at {formatTime12(r.session.startTime)}
                    {r.session.facility ? ` · ${r.session.facility.name}` : ""}
                    <div className="text-xs text-slate-400">
                      asked by {reqNameById.get(r.requestedByCoachId) ?? "a coach"}{r.note ? ` — “${r.note}”` : ""}
                    </div>
                  </div>
                  {isMine ? (
                    <form method="POST" action="/api/console/sub-requests">
                      {hidden}
                      <input type="hidden" name="op" value="cancel" />
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="returnTo" value="/console/lounge" />
                      <button className="text-xs text-slate-500 hover:underline">Your request · cancel</button>
                    </form>
                  ) : myCoachId ? (
                    <form method="POST" action="/api/console/sub-requests">
                      {hidden}
                      <input type="hidden" name="op" value="claim" />
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="returnTo" value="/console/lounge" />
                      <button className="rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">Cover this class →</button>
                    </form>
                  ) : (
                    <span className="text-xs text-slate-400">coaches can cover</span>
                  )}
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
