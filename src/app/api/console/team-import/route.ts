import { NextResponse } from "next/server";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { commitRosterImport } from "@/lib/domain/rosterImport";

// One-time club team-assignment import. Ticket-authorized, admin-only. Creates
// the teams and places players SILENTLY (commitRosterImport never notifies).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/team-import${qs}`, origin), 303);

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");
  if (String(fd.get("op") ?? "") !== "commit") return back("?err=op");

  const result = await commitRosterImport();
  if (!result) return back("?err=noseason");

  await audit({
    actorId: actor.userId,
    entityType: "Season",
    entityId: "roster-import",
    action: "ROSTER_IMPORT",
    summary: `Team import: ${result.teamsCreated} created, ${result.teamsReused} reused, ${result.assigned} players placed${result.skipped ? `, ${result.skipped} unmatched skipped` : ""}`,
  });

  const qs = new URLSearchParams({
    ok: "1",
    created: String(result.teamsCreated),
    reused: String(result.teamsReused),
    assigned: String(result.assigned),
    skipped: String(result.skipped),
  });
  return back(`?${qs.toString()}`);
}
