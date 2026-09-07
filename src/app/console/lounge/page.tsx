import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { requireStaff } from "@/lib/rbac";
import { isAdmin } from "@/lib/rbac";
import { formatStamp } from "@/lib/time";

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
