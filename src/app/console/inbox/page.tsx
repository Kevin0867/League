import Link from "next/link";
import { PageHeader } from "@/components/RoadmapNote";
import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { messageTargets, isAdminRole } from "@/lib/domain/messaging-acl";
import { searchInbox, moderationUnreadCount, coachModerationItems, coachModerationUnreadCount } from "@/lib/domain/messaging-store";
import { unreadInboxCount } from "@/lib/domain/inbox";
import { Composer, InboxList } from "@/components/messaging/Messaging";
import { CoachBroadcastComposer } from "@/components/messaging/CoachBroadcastComposer";
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

  // A coach gets a broadcast composer here (all coaches / all admins / any team
  // they coach). Admins broadcast from Communications; if an admin also coaches,
  // they see it too.
  const coach = personId ? await prisma.coach.findUnique({ where: { personId }, select: { id: true } }) : null;

  // Moderation views: admins see EVERY conversation; a coach sees messages
  // within the teams they coach (player↔player DMs to supervise).
  const adminModerating = isAdmin && sp.view === "all";
  const coachModerating = !isAdmin && !!coach && sp.view === "team";
  const moderating = adminModerating || coachModerating;

  const q = (sp.q ?? "").trim();
  const [items, targets, myUnread, allUnread, teamUnread] = await Promise.all([
    coachModerating ? coachModerationItems(session.userId) : personId ? searchInbox(personId, q, adminModerating) : Promise.resolve([]),
    personId ? messageTargets(personId, session.role) : Promise.resolve([]),
    personId ? unreadInboxCount(personId).catch(() => 0) : Promise.resolve(0),
    isAdmin ? moderationUnreadCount().catch(() => 0) : Promise.resolve(0),
    coach && !isAdmin ? coachModerationUnreadCount(session.userId).catch(() => 0) : Promise.resolve(0),
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
          <Link href="/console/inbox" className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium ${!moderating ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            My messages
            {myUnread > 0 && <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold ${!moderating ? "bg-white text-brand-700" : "bg-rose-500 text-white"}`}>{myUnread}</span>}
          </Link>
          <Link href="/console/inbox?view=all" className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium ${moderating ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            All conversations (moderation)
            {allUnread > 0 && <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold ${moderating ? "bg-white text-brand-700" : "bg-rose-500 text-white"}`}>{allUnread}</span>}
          </Link>
        </div>
      )}

      {coach && !isAdmin && (
        <div className="flex gap-2 text-sm">
          <Link href="/console/inbox" className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium ${!coachModerating ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            My messages
            {myUnread > 0 && <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold ${!coachModerating ? "bg-white text-brand-700" : "bg-rose-500 text-white"}`}>{myUnread}</span>}
          </Link>
          <Link href="/console/inbox?view=team" className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium ${coachModerating ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            My teams&apos; messages
            {teamUnread > 0 && <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold ${coachModerating ? "bg-white text-brand-700" : "bg-rose-500 text-white"}`}>{teamUnread}</span>}
          </Link>
        </div>
      )}

      {/* Conversations come first — reading and replying is the primary job of
          the inbox; the broadcast composer sits below it. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          {/* Search every message — subject, who's in the thread, or anything
              said in it. */}
          {!coachModerating && (
            <form method="GET" action="/console/inbox" className="flex gap-2">
              {adminModerating && <input type="hidden" name="view" value="all" />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search messages, people, subjects…"
                className="input flex-1"
                aria-label="Search messages"
              />
              <button className="btn-secondary text-sm">Search</button>
              {q && <Link href={adminModerating ? "/console/inbox?view=all" : "/console/inbox"} className="btn-back">Clear</Link>}
            </form>
          )}
          {q && !coachModerating ? (
            <p className="text-xs text-slate-500">{items.length} result{items.length === 1 ? "" : "s"} for &ldquo;{q}&rdquo;{items.length === 100 ? " (showing the first 100 — refine to narrow)" : ""}.</p>
          ) : coachModerating ? (
            <p className="text-xs text-slate-500">
              Messages between players (and parents) on the teams you coach — so you can keep an eye on team chat. Open any thread to review or step in; deleted messages are shown and retained. Team threads you&apos;re in appear under “My messages.”
            </p>
          ) : adminModerating ? (
            <p className="text-xs text-slate-500">
              Every conversation on the platform, newest first. Open any thread to review it — deleted messages are shown, flagged, and never removed. Use search to find older ones.
            </p>
          ) : null}
          <InboxList items={items} basePath="/console/inbox" />
        </div>
        {!moderating && <Composer targets={targets} ticket={ticket} returnTo="/console/inbox" library />}
      </div>

      {/* Staff broadcast — a one-way announcement to all coaches or all admins.
          Team messages now go to the replyable team thread (pick "… — whole
          team" in New message above), so a team isn't messaged one-way here. */}
      {coach && !moderating && (
        <CoachBroadcastComposer
          ticket={ticket}
          returnTo="/console/inbox"
          audiences={[
            { value: "ALL_COACHES", label: "All coaches", count: null, reachNote: "all coaches" },
            { value: "ALL_ADMINS", label: "All admins", count: null, reachNote: "all admins" },
          ]}
        />
      )}
    </div>
  );
}
