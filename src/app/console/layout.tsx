import { redirect } from "next/navigation";
import { ConsoleShell } from "@/components/ConsoleShell";
import { requireStaff, isAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { signWaiverToken } from "@/lib/domain/waiverRenewal";

// Never serve a cached/prerendered authed shell — always resolve the session.
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireStaff();
  const roles = session.roles ?? [session.role];
  const admin = isAdmin(roles);

  // Waiver gate for coaches: a coach must have a signed participation waiver
  // before using the console. If they don't, mint a no-login waiver link for
  // themselves and route them to sign it first; they return here afterward.
  // Admins are never gated (they need full access to run the club).
  if (!admin && roles.includes("COACH") && session.personId) {
    const person = await prisma.person.findUnique({
      where: { id: session.personId },
      select: { waiverSignedAt: true },
    });
    if (person && !person.waiverSignedAt) {
      const token = await signWaiverToken(session.personId);
      redirect(`/waiver/sign?token=${encodeURIComponent(token)}&next=${encodeURIComponent("/console")}`);
    }
  }

  // "Ask Brett" floats on every console page for admins only. Mint the signed
  // console ticket here (readable on this GET) so the client widget can auth its
  // POSTs without the session cookie, and let it degrade if no API key is set.
  const ask = admin
    ? { ticket: await mintConsoleTicket(), configured: !!process.env.ANTHROPIC_API_KEY }
    : null;
  return (
    <ConsoleShell role={session.role} name={session.name} ask={ask}>
      {children}
    </ConsoleShell>
  );
}
