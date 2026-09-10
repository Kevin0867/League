import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formatDateTime12 } from "@/lib/time";
import { Attachment } from "@/components/Attachment";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages" };

// Messages sent to the signed-in staff member (announcements, team updates, etc.)
// — the reader side of the broadcast system. Unread messages are highlighted and
// surfaced by the top banner + nav badge; the reader can mark read/unread and
// REPLY to any message, which reaches the original sender in-app + by text.
export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const personId = session.personId ?? "";

  const inbox = personId
    ? await prisma.messageRecipient.findMany({
        where: { personId, message: { channels: { contains: "IN_APP" } } },
        include: { message: { include: { sender: { select: { personId: true, person: { select: { firstName: true, lastName: true } } } } } } },
        orderBy: { message: { sentAt: "desc" } },
        take: 50,
      })
    : [];
  const unread = inbox.filter((r) => !r.readAt).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Messages" subtitle="Messages sent to you and your groups. Unread ones are highlighted; reply to any and it reaches the sender in-app and by text." />
        {unread > 0 && (
          <form method="POST" action="/api/console/messages">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="markAllBroadcastsRead" />
            <input type="hidden" name="returnTo" value="/console/announcements" />
            <button className="btn-secondary text-sm">Mark all read</button>
          </form>
        )}
      </div>

      {sp.ok && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {sp.ok === "readall" ? "All messages marked read." : sp.ok === "unread" ? "Marked unread." : "Marked read."}
        </div>
      )}
      {sp.msgreply === "1" && (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Reply sent — it&apos;s in the sender&apos;s inbox and they&apos;ve been texted.</div>
      )}
      {sp.msgreply && sp.msgreply !== "1" && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">
          {sp.msgreply === "nosender" ? "This message was automated — there's no individual to reply to." : sp.msgreply === "self" ? "That's your own message." : "Couldn't send the reply — try again."}
        </div>
      )}

      {inbox.length === 0 ? (
        <div className="card text-sm text-slate-400">No messages yet.</div>
      ) : (
        <div className="space-y-3">
          {inbox.map((r) => {
            const senderName = r.message.sender?.person ? `${r.message.sender.person.firstName} ${r.message.sender.person.lastName}` : null;
            const canReply = !!r.message.sender?.personId && r.message.sender.personId !== personId;
            return (
              <div key={r.id} className={`card ${!r.readAt ? "bg-brand-50 ring-2 ring-brand-300" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-900">{r.message.subject || "Message"}</h2>
                    <p className="text-xs text-slate-400">
                      {senderName ? `From ${senderName} · ` : ""}{formatDateTime12(r.message.sentAt)}
                    </p>
                  </div>
                  <form method="POST" action="/api/console/messages">
                    <input type="hidden" name="ticket" value={ticket} />
                    <input type="hidden" name="op" value={r.readAt ? "markBroadcastUnread" : "markBroadcastRead"} />
                    <input type="hidden" name="recipientId" value={r.id} />
                    <input type="hidden" name="returnTo" value="/console/announcements" />
                    <button className="btn-ghost text-xs whitespace-nowrap">{r.readAt ? "Mark unread" : "Mark read"}</button>
                  </form>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{r.message.body}</p>
                {r.message.attachmentUrl && <Attachment url={r.message.attachmentUrl} type={r.message.attachmentType} />}

                {canReply && (
                  <details className="mt-3 border-t border-slate-100 pt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-brand-700 hover:underline">Reply to {senderName ?? "sender"} →</summary>
                    <form method="POST" action="/api/messages" className="mt-2 space-y-2">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="replyToMessage" />
                      <input type="hidden" name="broadcastMessageId" value={r.messageId} />
                      <input type="hidden" name="returnTo" value="/console/announcements" />
                      <textarea name="body" rows={2} required className="input" placeholder={`Reply to ${senderName ?? "the sender"}…`} />
                      <button className="btn-secondary text-sm">Send reply</button>
                    </form>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
