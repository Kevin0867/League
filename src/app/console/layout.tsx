import { ConsoleShell } from "@/components/ConsoleShell";
import { requireStaff } from "@/lib/rbac";

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
