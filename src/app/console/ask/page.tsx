import "server-only";
import { PageHeader } from "@/components/RoadmapNote";
import { requireAdmin } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { AskConsole } from "@/components/AskConsole";

// "Ask the Console" — a read-only admin assistant. The page is admin-gated and
// mints a signed console ticket (readable on this GET) that the client sends
// with each question so the POST route can authorize without the session cookie.
export const dynamic = "force-dynamic";

export default async function AskPage() {
  await requireAdmin();
  const ticket = await mintConsoleTicket();
  const configured = !!process.env.ANTHROPIC_API_KEY;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ask the Console"
        subtitle="Find anything and run quick reports in plain English — registrations, revenue, teams, waivers. Read-only: it looks things up, it never changes your data."
      />
      <AskConsole ticket={ticket} configured={configured} />
    </div>
  );
}
