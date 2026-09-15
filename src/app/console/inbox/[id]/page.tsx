import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canUseMessaging, isAdminRole } from "@/lib/domain/messaging-acl";
import { getThread, markRead, canCoachModerate } from "@/lib/domain/messaging-store";
import { ConversationView } from "@/components/messaging/Messaging";
import { RefreshOnRead } from "@/components/RefreshOnRead";

export const dynamic = "force-dynamic";

export default async function ConsoleThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStaff();
  const ticket = await mintConsoleTicket();
  const personId = session.personId ?? "";
  const isAdmin = isAdminRole(session.role);
  // A coach may moderate a conversation that's entirely within the teams they
  // coach (player↔player DMs), even without being a participant.
  const coachCanModerate = !isAdmin && (await canCoachModerate(session.userId, id));
  const asModerator = isAdmin || coachCanModerate;

  const thread = await getThread(id, personId, asModerator);
  if (!thread) redirect("/console/inbox");

  const isParticipant = thread.participantIds.includes(personId);
  // Admins (and a coach over their own team) can reply to step in and help — not
  // just their own threads. Replying adds them to the conversation.
  const canPost = (isParticipant || asModerator) && canUseMessaging(session.role);

  // Was this thread unread for me before I opened it? If so, refresh the layout
  // once after marking read so the banner/badge clear immediately.
  let hadUnread = false;
  if (isParticipant) {
    const part = await prisma.conversationParticipant.findFirst({ where: { conversationId: id, personId }, select: { lastReadAt: true } });
    const lastOther = [...thread.messages].reverse().find((m) => !m.mine && !m.deleted);
    hadUnread = !!lastOther && (!part?.lastReadAt || lastOther.createdAt > part.lastReadAt);
    await markRead(id, personId);
  }

  return (
    <>
      <RefreshOnRead active={hadUnread} />
      <ConversationView
        thread={thread}
        ticket={ticket}
        basePath="/console/inbox"
        canPost={canPost}
        isModerator={asModerator && !isParticipant}
        library
      />
    </>
  );
}
