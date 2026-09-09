import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { Role } from "@/lib/enums";

// Coach-editable player details. A coach can keep a player's profile current
// from the player's page — contact (name, emails, phone, address, DOB, gender),
// emergency contact, medical notes, and the parent/guardian's contact — but only
// for players on a team they coach, and never fees, status, roles, or waivers.
// Admins may edit anyone. Everything else stays on the admin registration record.
export const dynamic = "force-dynamic";

/** Admin, or a coach of `teamId` where `personId` is on that team's roster. */
async function authorize(
  actor: { userId: string; role: string } | null,
  teamId: string,
  personId: string,
): Promise<boolean> {
  if (!actor) return false;
  if (can(actor.role as Role, "manageTeams")) return true;
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { personId: true } });
  if (!user?.personId) return false;
  const coach = await prisma.coach.findUnique({ where: { personId: user.personId }, select: { id: true } });
  if (!coach) return false;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { coachId: true, assistantCoaches: { select: { coachId: true } } },
  });
  const ownsTeam = !!team && (team.coachId === coach.id || team.assistantCoaches.some((a) => a.coachId === coach.id));
  if (!ownsTeam) return false;
  const member = await prisma.teamMember.findUnique({ where: { teamId_personId: { teamId, personId } }, select: { id: true } });
  return !!member;
}

const clean = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
};
const cleanEmail = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s.length ? s : null;
};

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const formData = await req.formData();
  const teamId = String(formData.get("teamId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/teams/${teamId}/progress/${personId}${qs}`, origin), 303);

  const actor = await actorFromForm(formData);
  if (!(await authorize(actor, teamId, personId))) return back("?err=auth");

  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true, guardianId: true } });
  if (!person) return back("?err=nostudent");

  const firstName = clean(formData.get("firstName"));
  const lastName = clean(formData.get("lastName"));
  // Date of birth: anchor to UTC noon so the stored day matches what was entered
  // regardless of timezone (a bare date parsed as UTC midnight reads a day early).
  const dobRaw = clean(formData.get("dob"));
  const dob = dobRaw && /^\d{4}-\d{2}-\d{2}$/.test(dobRaw) ? new Date(`${dobRaw}T12:00:00Z`) : null;
  await prisma.person.update({
    where: { id: personId },
    data: {
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      email: cleanEmail(formData.get("email")),
      email2: cleanEmail(formData.get("email2")),
      email3: cleanEmail(formData.get("email3")),
      phone: clean(formData.get("phone")),
      // Demographics + emergency + medical. The prisma encryption extension
      // transparently encrypts address / emergency* / medicalNotes on write.
      address: clean(formData.get("address")),
      dob,
      gender: clean(formData.get("gender")),
      emergencyName: clean(formData.get("emergencyName")),
      emergencyPhone: clean(formData.get("emergencyPhone")),
      emergencyRelation: clean(formData.get("emergencyRelation")),
      medicalNotes: clean(formData.get("medicalNotes")),
    },
  });

  // Parent/guardian contact — only when a guardian is linked.
  if (person.guardianId) {
    await prisma.person.update({
      where: { id: person.guardianId },
      data: {
        email: cleanEmail(formData.get("guardianEmail")),
        phone: clean(formData.get("guardianPhone")),
      },
    });
  }

  await audit({ actorId: actor!.userId, entityType: "Person", entityId: personId, action: "contact.update", summary: "Coach updated player details (contact / emergency / medical)" });
  return back("?ok=contact");
}
