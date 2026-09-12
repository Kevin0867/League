import Link from "next/link";
import { formatDateTime12 } from "@/lib/time";
import type { InboxItem, Thread } from "@/lib/domain/messaging-store";
import type { Contact } from "@/lib/domain/messaging-acl";
import { MediaAttach } from "@/components/MediaAttach";
import { Attachment } from "@/components/Attachment";

// Shared server components for the direct-messaging UI, rendered in both the
// console (admin, coach) and the family portal (parent). All actions are native
// form POSTs to /api/messages carrying a console ticket.

export function Composer({ contacts, ticket, returnTo, library = false }: { contacts: Contact[]; ticket: string; returnTo: string; library?: boolean }) {
  if (contacts.length === 0) {
    return (
      <div className="card text-sm text-slate-500">
        You don&apos;t have anyone to message yet. Contacts appear here once you share a team.
      </div>
    );
  }
  return (
    <form method="POST" action="/api/messages" className="card space-y-3">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="start" />
      <input type="hidden" name="returnTo" value={returnTo} />
      <h2 className="font-semibold text-slate-900">New message</h2>
      <div>
        <label className="label">To</label>
        <select name="recipientId" className="input" defaultValue="" required>
          <option value="" disabled>Choose a person…</option>
          {contacts.map((c) => (
            <option key={c.personId} value={c.personId}>
              {c.name} · {c.role === "ADMIN" ? "Admin" : c.role === "COACH" ? "Coach" : "Parent"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Message</label>
        <textarea name="body" rows={3} className="input" placeholder="Write a message…" />
      </div>
      <MediaAttach library={library} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NotifyByPicker />
        <button type="submit" className="btn-primary">Send</button>
      </div>
    </form>
  );
}

/** How to notify the recipient a message arrived (in-app is always on). The
 *  sender picks Email, Text, or both — read by /api/messages. */
function NotifyByPicker() {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Notify by</span>
      <label className="flex items-center gap-1.5"><input type="checkbox" name="notifyEmail" defaultChecked /> Email</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" name="notifySms" defaultChecked /> Text</label>
    </div>
  );
}

export function InboxList({ items, basePath }: { items: InboxItem[]; basePath: string }) {
  if (items.length === 0) {
    return <div className="card text-sm text-slate-400">No conversations yet.</div>;
  }
  return (
    <div className="card divide-y divide-slate-100 p-0">
      {items.map((it) => (
        <Link
          key={it.id}
          href={`${basePath}/${it.id}`}
          className={`flex items-start gap-3 px-4 py-3 ${it.unread ? "bg-brand-50 hover:bg-brand-100" : "hover:bg-slate-50"}`}
        >
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${it.unread ? "bg-brand-600" : "bg-transparent"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className={`flex min-w-0 items-center gap-2 truncate text-sm ${it.unread ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>
                <span className="truncate">{it.others}</span>
                {it.unread && <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">New</span>}
              </span>
              <span className="shrink-0 text-xs text-slate-400">{formatDateTime12(it.lastMessageAt)}</span>
            </div>
            <p className={`truncate text-sm ${it.unread ? "text-slate-700" : "text-slate-500"}`}>{it.preview}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function ConversationView({
  thread,
  ticket,
  basePath,
  canPost,
  isModerator,
  library = false,
}: {
  thread: Thread;
  ticket: string;
  basePath: string;
  canPost: boolean;
  isModerator: boolean;
  library?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href={basePath} className="btn-back">← All messages</Link>
        {canPost && (
          <form method="POST" action="/api/messages">
            <input type="hidden" name="ticket" value={ticket} />
            <input type="hidden" name="op" value="archive" />
            <input type="hidden" name="conversationId" value={thread.id} />
            <input type="hidden" name="returnTo" value={basePath} />
            <button className="text-xs text-slate-400 hover:text-slate-600 hover:underline">Archive</button>
          </form>
        )}
      </div>

      <div>
        <h1 className="text-lg font-bold text-slate-900">{thread.others || "Conversation"}</h1>
        {isModerator && !canPost && (
          <p className="text-xs text-amber-600">Moderation view — you are not a participant. Deleted messages are shown for review.</p>
        )}
        {isModerator && canPost && (
          <p className="text-xs text-amber-600">Admin view — you&apos;re not in this conversation. Replying will add you so both people see your message. Deleted messages are shown for review.</p>
        )}
      </div>

      <div className="card space-y-3">
        {thread.messages.length === 0 && <p className="text-sm text-slate-400">No messages.</p>}
        {thread.messages.map((m) => {
          const hiddenForViewer = m.deleted && !isModerator;
          return (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"}`}>
                {!m.mine && <div className="mb-0.5 text-xs font-semibold opacity-80">{m.senderName}</div>}
                {hiddenForViewer ? (
                  <div className="italic opacity-70">Message deleted</div>
                ) : (
                  <div className="whitespace-pre-wrap break-words">
                    {m.body}
                    {m.deleted && isModerator && <span className="ml-2 rounded bg-rose-200 px-1 text-[10px] font-semibold text-rose-800 align-middle">DELETED</span>}
                    {m.attachmentUrl && <Attachment url={m.attachmentUrl} type={m.attachmentType} />}
                  </div>
                )}
                <div className={`mt-1 flex items-center gap-2 text-[11px] ${m.mine ? "text-white/70" : "text-slate-400"}`}>
                  <span>{formatDateTime12(m.createdAt)}</span>
                  {m.mine && !m.deleted && canPost && (
                    <form method="POST" action="/api/messages" className="inline">
                      <input type="hidden" name="ticket" value={ticket} />
                      <input type="hidden" name="op" value="deleteMessage" />
                      <input type="hidden" name="messageId" value={m.id} />
                      <input type="hidden" name="conversationId" value={thread.id} />
                      <input type="hidden" name="returnTo" value={basePath} />
                      <button className="underline hover:opacity-100">delete</button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {canPost ? (
        <form method="POST" action="/api/messages" className="card space-y-2">
          <input type="hidden" name="ticket" value={ticket} />
          <input type="hidden" name="op" value="reply" />
          <input type="hidden" name="conversationId" value={thread.id} />
          <input type="hidden" name="returnTo" value={basePath} />
          <textarea name="body" rows={2} className="input" placeholder="Write a reply…" />
          <MediaAttach library={library} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <NotifyByPicker />
            <button type="submit" className="btn-primary">Send</button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-slate-400">Read-only.</p>
      )}
    </div>
  );
}
