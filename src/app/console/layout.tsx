import { ConsoleShell } from "@/components/ConsoleShell";
import { requireStaff } from "@/lib/rbac";

// Never serve a cached/prerendered authed shell — always resolve the session.
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireStaff();
  return (
    <ConsoleShell role={session.role} name={session.name}>
      {children}
    </ConsoleShell>
  );
}
