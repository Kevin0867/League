import Link from "next/link";
import { Logo, PadelLogo } from "@/components/Brand";
import { requireUser } from "@/lib/rbac";
import { canUseMessaging } from "@/lib/domain/messaging-acl";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireUser();
  const showMessages = canUseMessaging(session.role);
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo href="/portal" />
          <div className="flex items-center gap-3 text-sm">
            <Link href="/portal/lessons" className="font-medium text-brand-700 hover:underline">Lessons</Link>
            {showMessages && <Link href="/portal/inbox" className="font-medium text-brand-700 hover:underline">Messages</Link>}
            <span className="hidden text-slate-500 sm:inline">{session.name}</span>
            <Link href="/logout" prefetch={false} className="btn-ghost">Sign out</Link>
            <PadelLogo className="hidden h-11 sm:block" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
