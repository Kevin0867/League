import Link from "next/link";
import { Logo, PadelLogo } from "@/components/Brand";
import { requireUser } from "@/lib/rbac";
import { canUseMessagingPerson } from "@/lib/domain/messaging-acl";
import { unreadInboxCount, firstUnreadInboxId } from "@/lib/domain/inbox";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireUser();
  const showMessages = await canUseMessagingPerson(session.personId ?? "", session.role);
  const [unread, firstUnreadId] = showMessages
    ? await Promise.all([
        unreadInboxCount(session.personId).catch(() => 0),
        firstUnreadInboxId(session.personId).catch(() => null),
      ])
    : [0, null];
  // Tap the banner to open the unread conversation (which marks it read); only
  // fall back to the list when we can't resolve a single thread.
  const unreadHref = firstUnreadId ? `/portal/inbox/${firstUnreadId}` : "/portal/inbox";
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo href="/portal" />
          <div className="flex items-center gap-3 text-sm">
            <Link href="/portal/lessons" className="font-medium text-brand-700 hover:underline">Lessons</Link>
            {showMessages && (
              <Link href="/portal/inbox" className="relative font-medium text-brand-700 hover:underline">
                Messages
                {unread > 0 && (
                  <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-xs font-bold text-white">{unread}</span>
                )}
              </Link>
            )}
            <span className="hidden text-slate-500 sm:inline">{session.name}</span>
            <Link href="/logout" prefetch={false} className="btn-ghost">Sign out</Link>
            <PadelLogo className="hidden h-11 sm:block" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {unread > 0 && (
          <Link
            href={unreadHref}
            className="mb-4 flex items-center gap-3 rounded-lg border border-accent-400 bg-accent-50 px-4 py-3 text-sm font-medium text-brand-900 hover:bg-accent-100"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-900 text-xs font-bold text-white">{unread}</span>
            You have {unread} unread {unread === 1 ? "message" : "messages"} — tap to read {unread === 1 ? "it" : "them"} →
          </Link>
        )}
        {children}
      </main>
    </div>
  );
}
