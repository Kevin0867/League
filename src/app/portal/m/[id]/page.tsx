import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { mintConsoleTicket } from "@/lib/auth";
import { MessageFrame } from "@/components/MessageFrame";
import { Attachment } from "@/components/Attachment";
import { MediaAttach } from "@/components/MediaAttach";
import { formatStamp } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Message" };

// A single broadcast/announcement, deep-linked from its text/email so a
// recipient lands straight on the full message (not the portal home). Only a
// recipient of the message can open it; opening marks it read.
export default async function PortalMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const ticket = await mintConsoleTicket();

  const me = session.personId
    ? await prisma.person.findUnique({ where: { id: session.personId }, include: { dependents: { select: { id: true } } } })
    : null;
  const peopleIds = [...(me ? [me.id] : []), ...(me?.dependents.map((d) => d.id) ?? [])];

  const message = await prisma.message.findUnique({
    where: { id },
    include: { sender: { select: { personId: true, person: { select: { firstName: true, lastName: true } } } } },
  });
  // Authorize: the logged-in household must be a recipient of this message.
  const recipient = peopleIds.length
    ? await prisma.messageRecipient.findFirst({ where: { messageId: id, personId: { in: peopleIds } } })
    : null;
  if (!message || !recipient) redirect("/portal");

  // Opening the message marks that recipient row read.
  if (!recipient.readAt) {
    await prisma.messageRecipient.update({ where: { id: recipient.id }, data: { readAt: new Date() } }).catch(() => {});
  }

  const senderName = message.sender?.person
    ? `${message.sender.person.firstName} ${message.sender.person.lastName}`.trim()
    : "PURE Academy";
  const canReply = !!message.sender?.personId && message.sender.personId !== session.personId;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/portal" className="btn-back">← Home</Link>

      <div className="card">
        <h1 className="text-xl font-bold text-slate-900">{message.subject ?? "Message from PURE Academy"}</h1>
        <p className="mt-0.5 text-xs text-slate-400">From {senderName} · {formatStamp(message.sentAt)}</p>

        {message.html ? (
          <div className="mt-3"><MessageFrame html={message.html} /></div>
        ) : (
          <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{message.body}</p>
        )}
        {message.attachmentUrl && <Attachment url={message.attachmentUrl} type={message.attachmentType} />}

        {canReply && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="text-xs font-semibold text-brand-700">Reply to {message.sender?.person?.firstName ?? "PURE Academy"}</div>
            <form method="POST" action="/api/messages" className="mt-2 space-y-2">
              <input type="hidden" name="ticket" value={ticket} />
              <input type="hidden" name="op" value="replyToMessage" />
              <input type="hidden" name="broadcastMessageId" value={message.id} />
              <input type="hidden" name="returnTo" value="/portal" />
              <textarea name="body" rows={2} className="input" placeholder="Write your reply…" />
              <MediaAttach label="Add a photo / video" />
              <button className="btn-secondary text-sm">Send reply</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
