import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { canUseMessaging } from "@/lib/domain/messaging-acl";
import { getThread, markRead } from "@/lib/domain/messaging-store";
import { ConversationView } from "@/components/messaging/Messaging";

export const dynamic = "force-dynamic";

export default async function PortalThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  if (!canUseMessaging(session.role)) redirect("/portal");
  const ticket = await mintConsoleTicket();
  const personId = session.personId ?? "";

  // Parents are never moderators — they only see threads they're part of.
  const thread = await getThread(id, personId, false);
  if (!thread) redirect("/portal/inbox");
  await markRead(id, personId);

  return (
    <ConversationView
      thread={thread}
      ticket={ticket}
      basePath="/portal/inbox"
      canPost={true}
      isModerator={false}
    />
  );
}
