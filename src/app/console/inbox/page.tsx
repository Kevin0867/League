import Link from "next/link";
import { PageHeader } from "@/components/RoadmapNote";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { allowedContacts, isAdminRole } from "@/lib/domain/messaging-acl";
import { inboxItems, moderationItems } from "@/lib/domain/messaging-store";
import { Composer, InboxList } from "@/components/messaging/Messaging";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  perm: "You can't message that person.",
  fields: "Pick a recipient and write a message.",
  op: "Unknown action.",
};
const OKS: Record<string, string> = { archived: "Conversation archived.", deleted: "Message deleted." };

export default async function ConsoleInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await requireStaff();
  const ticket = await mintConsoleTicket();
  const personId = session.personId ?? "";
  const isAdmin = isAdminRole(session.role);
  const moderating = isAdmin && sp.view === "all";

  const [items, contacts] = await Promise.all([
    moderating ? moderationItems() : (personId ? inboxItems(personId) : Promise.resolve([])),
    personId ? allowedContacts(personId, session.role) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        subtitle="Direct messages. Every conversation stays on the platform and is retained for review."
      />
      {sp.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{OKS[sp.ok] ?? "Done."}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}

      {isAdmin && (
        <div className="flex gap-2 text-sm">
          <Link href="/console/inbox" className={`rounded-lg px-3 py-1.5 font-medium ${!moderating ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>My messages</Link>
          <Link href="/console/inbox?view=all" className={`rounded-lg px-3 py-1.5 font-medium ${moderating ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>All conversations (moderation)</Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          {moderating && (
            <p className="text-xs text-slate-500">
              Every conversation on the platform, newest first. Open any thread to review it — deleted messages are shown, flagged, and never removed.
            </p>
          )}
          <InboxList items={items} basePath="/console/inbox" />
        </div>
        {!moderating && <Composer contacts={contacts} ticket={ticket} returnTo="/console/inbox" />}
      </div>
    </div>
  );
}
