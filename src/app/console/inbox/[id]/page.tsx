import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { canUseMessaging, isAdminRole } from "@/lib/domain/messaging-acl";
import { getThread, markRead } from "@/lib/domain/messaging-store";
import { ConversationView } from "@/components/messaging/Messaging";

export const dynamic = "force-dynamic";

export default async function ConsoleThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStaff();
  const ticket = await mintConsoleTicket();
  const personId = session.personId ?? "";
  const isAdmin = isAdminRole(session.role);

  const thread = await getThread(id, personId, isAdmin);
  if (!thread) redirect("/console/inbox");

  const isParticipant = thread.participantIds.includes(personId);
  const canPost = isParticipant && canUseMessaging(session.role);
  if (isParticipant) await markRead(id, personId);

  return (
    <ConversationView
      thread={thread}
      ticket={ticket}
      basePath="/console/inbox"
      canPost={canPost}
      isModerator={isAdmin && !isParticipant}
    />
  );
}
