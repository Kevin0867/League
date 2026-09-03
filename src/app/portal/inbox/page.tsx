import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { allowedContacts, canUseMessagingPerson } from "@/lib/domain/messaging-acl";
import { inboxItems } from "@/lib/domain/messaging-store";
import { Composer, InboxList } from "@/components/messaging/Messaging";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  perm: "You can't message that person.",
  fields: "Pick a recipient and write a message.",
};
const OKS: Record<string, string> = { archived: "Conversation archived.", deleted: "Message deleted." };

export default async function PortalInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await requireUser();
  const personId = session.personId ?? "";
  if (!(await canUseMessagingPerson(personId, session.role))) redirect("/portal");
  const ticket = await mintConsoleTicket();

  const [items, contacts] = await Promise.all([
    personId ? inboxItems(personId) : Promise.resolve([]),
    personId ? allowedContacts(personId, session.role) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
        <p className="text-sm text-slate-500">Message your academy admins, your player&apos;s coaches, and other team parents.</p>
      </div>
      {sp.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{OKS[sp.ok] ?? "Done."}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}

      <Composer contacts={contacts} ticket={ticket} returnTo="/portal/inbox" />
      <InboxList items={items} basePath="/portal/inbox" />
    </div>
  );
}
