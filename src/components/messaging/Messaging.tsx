import Link from "next/link";
import { formatDateTime12 } from "@/lib/time";
import type { InboxItem, Thread } from "@/lib/domain/messaging-store";
import type { Contact } from "@/lib/domain/messaging-acl";

// Shared server components for the direct-messaging UI, rendered in both the
// console (admin, coach) and the family portal (parent). All actions are native
// form POSTs to /api/messages carrying a console ticket.

export function Composer({ contacts, ticket, returnTo }: { contacts: Contact[]; ticket: string; returnTo: string }) {
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
        <textarea name="body" rows={3} className="input" required placeholder="Write a message…" />
      </div>
      <button type="submit" className="btn-primary">Send</button>
    </form>
  );
}

export function InboxList({ items, basePath }: { items: InboxItem[]; basePath: string }) {
  if (items.length === 0) {
    return <div className="card text-sm text-slate-400">No conversations yet.</div>;
  }
  return (
    <div className="card divide-y divide-slate-100 p-0">
      {items.map((it) => (
        <Link key={it.id} href={`${basePath}/${it.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${it.unread ? "bg-brand-600" : "bg-transparent"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className={`truncate text-sm ${it.unread ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>
                {it.others}
              </span>
              <span className="shrink-0 text-xs text-slate-400">{formatDateTime12(it.lastMessageAt)}</span>
            </div>
            <p className="truncate text-sm text-slate-500">{it.preview}</p>
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
}: {
  thread: Thread;
  ticket: string;
  basePath: string;
  canPost: boolean;
  isModerator: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href={basePath} className="text-sm text-slate-500 hover:underline">← All messages</Link>
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
          <textarea name="body" rows={2} className="input" required placeholder="Write a reply…" />
          <div className="flex justify-end">
            <button type="submit" className="btn-primary">Send</button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-slate-400">Read-only.</p>
      )}
    </div>
  );
}
