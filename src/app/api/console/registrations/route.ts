import { NextResponse } from "next/server";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { ingestRegistration } from "@/lib/domain/intake";

// Add a player from the console: creates the Person + Registration through the
// shared intake path (dedup + all fields), so a walk-in lands in the roster and
// assignment pools just like a self-registration. Ticket-authorized route
// handler (see /api/console/facilities).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/registrations${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "managePlayers")) return back("?err=auth");
  if (String(formData.get("op") ?? "") !== "addPlayer") return back("?err=op");

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const dob = String(formData.get("dob") ?? "").trim() || null;
  const divisionId = String(formData.get("divisionId") ?? "").trim() || null;
  const seasonId = String(formData.get("seasonId") ?? "").trim() || null;

  if (!firstName || !lastName) return back("?err=name");
  if (!email && !phone) return back("?err=contact");

  try {
    await ingestRegistration({
      firstName,
      lastName,
      email,
      phone,
      dob,
      divisionId,
      seasonId,
      source: "console",
    });
  } catch {
    return back("?err=failed");
  }
  return back("?ok=addPlayer");
}
