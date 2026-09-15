import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canUseMessagingPerson } from "@/lib/domain/messaging-acl";
import { getThread, markRead } from "@/lib/domain/messaging-store";
import { ConversationView } from "@/components/messaging/Messaging";
import { RefreshOnRead } from "@/components/RefreshOnRead";

export const dynamic = "force-dynamic";

export default async function PortalThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const personId = session.personId ?? "";
  if (!(await canUseMessagingPerson(personId, session.role))) redirect("/portal");
  const ticket = await mintConsoleTicket();

  // Parents are never moderators — they only see threads they're part of.
  const thread = await getThread(id, personId, false);
  if (!thread) redirect("/portal/inbox");

  const part = await prisma.conversationParticipant.findFirst({ where: { conversationId: id, personId }, select: { lastReadAt: true } });
  const lastOther = [...thread.messages].reverse().find((m) => !m.mine && !m.deleted);
  const hadUnread = !!lastOther && (!part?.lastReadAt || lastOther.createdAt > part.lastReadAt);
  await markRead(id, personId);

  return (
    <>
      <RefreshOnRead active={hadUnread} />
      <ConversationView
        thread={thread}
        ticket={ticket}
        basePath="/portal/inbox"
        canPost={true}
        isModerator={false}
      />
    </>
  );
}
