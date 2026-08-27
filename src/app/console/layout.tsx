import { ConsoleShell } from "@/components/ConsoleShell";
import { requireStaff, isAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";

// Never serve a cached/prerendered authed shell — always resolve the session.
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireStaff();
  // "Ask Brett" floats on every console page for admins only. Mint the signed
  // console ticket here (readable on this GET) so the client widget can auth its
  // POSTs without the session cookie, and let it degrade if no API key is set.
  const admin = isAdmin(session.roles ?? [session.role]);
  const ask = admin
    ? { ticket: await mintConsoleTicket(), configured: !!process.env.ANTHROPIC_API_KEY }
    : null;
  return (
    <ConsoleShell role={session.role} name={session.name} ask={ask}>
      {children}
    </ConsoleShell>
  );
}
