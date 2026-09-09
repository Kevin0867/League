import Link from "next/link";
import { PageHeader } from "@/components/RoadmapNote";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { allowedContacts, isAdminRole } from "@/lib/domain/messaging-acl";
import { inboxItems, moderationItems } from "@/lib/domain/messaging-store";
import { Composer, InboxList } from "@/components/messaging/Messaging";
import { CoachBroadcastComposer, type BroadcastAudience } from "@/components/messaging/CoachBroadcastComposer";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: "Inbox" };

const ERRORS: Record<string, string> = {
  perm: "You can't message that audience.",
  fields: "Pick a recipient and write a message.",
  body: "Write a message before sending.",
  channels: "Pick at least one way to send (in-app or email).",
  team: "You can only message a team you coach.",
  norecipients: "No one matched that audience.",
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

  // A coach gets a broadcast composer here (all coaches / all admins / any team
  // they coach). Admins broadcast from Communications; if an admin also coaches,
  // they see it too.
  const coach = personId ? await prisma.coach.findUnique({ where: { personId }, select: { id: true } }) : null;
  const myTeams = coach
    ? await prisma.team.findMany({
        where: { OR: [{ coachId: coach.id }, { assistantCoaches: { some: { coachId: coach.id } } }] },
        select: { id: true, name: true, _count: { select: { members: true } } },
        orderBy: { name: "asc" },
      })
    : [];

  const [items, contacts] = await Promise.all([
    moderating ? moderationItems() : (personId ? inboxItems(personId) : Promise.resolve([])),
    personId ? allowedContacts(personId, session.role) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        subtitle="Direct messages and broadcasts. Everything stays on the platform and is retained for review."
      />
      {sp.ok === "1" && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Broadcast sent to {sp.n ?? 0} recipient{sp.n === "1" ? "" : "s"}
          {sp.failed && sp.failed !== "0" ? ` · ${sp.failed} couldn't be reached` : ""}.
        </p>
      )}
      {sp.ok && OKS[sp.ok] && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{OKS[sp.ok]}</p>}
      {sp.err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong."}</p>}

      {isAdmin && (
        <div className="flex gap-2 text-sm">
          <Link href="/console/inbox" className={`rounded-lg px-3 py-1.5 font-medium ${!moderating ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>My messages</Link>
          <Link href="/console/inbox?view=all" className={`rounded-lg px-3 py-1.5 font-medium ${moderating ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>All conversations (moderation)</Link>
        </div>
      )}

      {/* Conversations come first — reading and replying is the primary job of
          the inbox; the broadcast composer sits below it. */}
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

      {/* Broadcast composer — coaches message a whole group at once. Defaults to
          their own team, shows the reach, and confirms before sending. Every
          send is logged per-person in Communications, visible to admins. */}
      {coach && !moderating && (
        <CoachBroadcastComposer
          ticket={ticket}
          returnTo="/console/inbox"
          audiences={[
            ...myTeams.map((t): BroadcastAudience => ({
              value: `TEAM:${t.id}`,
              label: `Everyone on ${t.name} (players + parents)`,
              count: t._count.members,
              reachNote: `${t._count.members} player${t._count.members === 1 ? "" : "s"} on ${t.name} and their parents`,
            })),
            { value: "ALL_COACHES", label: "All coaches", count: null, reachNote: "all coaches" },
            { value: "ALL_ADMINS", label: "All admins", count: null, reachNote: "all admins" },
          ]}
        />
      )}
    </div>
  );
}
