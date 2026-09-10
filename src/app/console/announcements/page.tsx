import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formatDateTime12 } from "@/lib/time";
import { Attachment } from "@/components/Attachment";

export const dynamic = "force-dynamic";
export const metadata = { title: "Announcements" };

// Received broadcasts/announcements for the signed-in staff member — the reader
// side of the Messaging system (the compose side lives on /console/messages).
// So a coach or admin actually sees announcements sent to them in-app, with the
// unread ones surfaced by the top banner + nav badge, and can mark read/unread.
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
        include: { message: { include: { sender: { select: { person: { select: { firstName: true, lastName: true } } } } } } },
        orderBy: { message: { sentAt: "desc" } },
        take: 50,
      })
    : [];
  const unread = inbox.filter((r) => !r.readAt).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Announcements" subtitle="Messages sent to you and your groups. New ones show at the top of every page until you read them." />
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
          {sp.ok === "readall" ? "All announcements marked read." : sp.ok === "unread" ? "Marked unread." : "Marked read."}
        </div>
      )}

      {inbox.length === 0 ? (
        <div className="card text-sm text-slate-400">No announcements yet.</div>
      ) : (
        <div className="space-y-3">
          {inbox.map((r) => (
            <div key={r.id} className={`card ${!r.readAt ? "border-l-4 border-brand-400" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900">
                    {!r.readAt && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand-600 align-middle" />}
                    {r.message.subject || "Announcement"}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {r.message.sender?.person ? `From ${r.message.sender.person.firstName} ${r.message.sender.person.lastName} · ` : ""}{formatDateTime12(r.message.sentAt)}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
