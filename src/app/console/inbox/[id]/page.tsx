import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { canUseMessaging, isAdminRole } from "@/lib/domain/messaging-acl";
import { getThread, markRead, canCoachModerate } from "@/lib/domain/messaging-store";
import { ConversationView } from "@/components/messaging/Messaging";

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
  if (isParticipant) await markRead(id, personId);

  return (
    <ConversationView
      thread={thread}
      ticket={ticket}
      basePath="/console/inbox"
      canPost={canPost}
      isModerator={asModerator && !isParticipant}
      library
    />
  );
}
