import Link from "next/link";
import { Logo } from "@/components/Brand";
import { requireUser } from "@/lib/rbac";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireUser();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo href="/portal" />
          <div className="flex items-center gap-3 text-sm">
            <Link href="/portal/lessons" className="font-medium text-brand-700 hover:underline">Lessons</Link>
            <span className="hidden text-slate-500 sm:inline">{session.name}</span>
            <Link href="/logout" className="btn-ghost">Sign out</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
