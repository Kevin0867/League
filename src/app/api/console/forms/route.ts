import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { isStaff, isAdmin } from "@/lib/rbac";
import type { Role } from "@/lib/enums";
import { audit } from "@/lib/audit";
import { PROGRESS_WEEKS, SR_SERVE, SR_RETURN, SR_NOTE, DEV_CATEGORIES, DEV_NOTE } from "@/lib/domain/coachingForms";

// Save coaching-form data. Staff only; a coach may only write for a team they
// coach (admins any). Entries upsert into PlayerProgressEntry so they're
// quantifiable and analyzable over time.
export const dynamic = "force-dynamic";

async function canEditTeam(actorUserId: string, role: Role, teamId: string): Promise<boolean> {
  if (isAdmin(role)) return true;
  const me = await prisma.user.findUnique({ where: { id: actorUserId }, select: { personId: true } });
  const coach = me?.personId ? await prisma.coach.findUnique({ where: { personId: me.personId }, select: { id: true } }) : null;
  if (!coach) return false;
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { coachId: true, assistantCoaches: { select: { coachId: true } } } });
  return !!team && (team.coachId === coach.id || team.assistantCoaches.some((a) => a.coachId === coach.id));
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const op = String(fd.get("op") ?? "");
  const teamId = String(fd.get("teamId") ?? "").trim();
  const formSlug = String(fd.get("formSlug") ?? "serve-return").replace(/[^a-z-]/g, "") || "serve-return";
  const back = (qs: string) =>
    NextResponse.redirect(new URL(`/console/forms/${formSlug}?team=${encodeURIComponent(teamId)}${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor || !isStaff(actor.role)) return back("&err=auth");
  if (!teamId || !(await canEditTeam(actor.userId, actor.role, teamId))) return back("&err=auth");

  if (op === "saveServeReturn") {
    const personIds = String(fd.get("personIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { seasonId: true } });
    const seasonId = team?.seasonId ?? null;
    const num = (v: FormDataEntryValue | null) => {
      const s = String(v ?? "").trim();
      if (s === "") return null;
      const n = parseFloat(s.replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) ? n : null;
    };

    const writes: Promise<unknown>[] = [];
    const upsert = (personId: string, week: number, metric: string, value: number | null, note: string | null) =>
      prisma.playerProgressEntry.upsert({
        where: { teamId_personId_week_metric: { teamId, personId, week, metric } },
        create: { teamId, personId, seasonId, week, metric, value, note, recordedById: actor.userId },
        update: { value, note, recordedById: actor.userId },
      });

    for (const personId of personIds) {
      for (let wk = 1; wk <= PROGRESS_WEEKS; wk++) {
        writes.push(upsert(personId, wk, SR_SERVE, num(fd.get(`sr_${personId}_${wk}_SERVE`)), null));
        writes.push(upsert(personId, wk, SR_RETURN, num(fd.get(`sr_${personId}_${wk}_RETURN`)), null));
      }
      const note = String(fd.get(`note_${personId}`) ?? "").trim() || null;
      writes.push(upsert(personId, 0, SR_NOTE, null, note));
    }
    await Promise.all(writes).catch((e) => console.error("serve-return save failed", e));
    await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "FORM_SERVE_RETURN", summary: `Saved Serve & Return tracker for ${personIds.length} player(s)` });
    return back("&ok=1");
  }

  if (op === "saveDevelopment") {
    const personIds = String(fd.get("personIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { seasonId: true } });
    const seasonId = team?.seasonId ?? null;
    const writes: Promise<unknown>[] = [];
    const upsert = (personId: string, metric: string, value: number | null, note: string | null) =>
      prisma.playerProgressEntry.upsert({
        where: { teamId_personId_week_metric: { teamId, personId, week: 0, metric } },
        create: { teamId, personId, seasonId, week: 0, metric, value, note, recordedById: actor.userId },
        update: { value, note, recordedById: actor.userId },
      });
    for (const personId of personIds) {
      for (const c of DEV_CATEGORIES) {
        const raw = String(fd.get(`dev_${personId}_${c.key}`) ?? "").trim();
        const value = raw === "" ? null : Number(raw);
        writes.push(upsert(personId, c.key, Number.isFinite(value as number) ? (value as number) : null, null));
      }
      const note = String(fd.get(`note_${personId}`) ?? "").trim() || null;
      writes.push(upsert(personId, DEV_NOTE, null, note));
    }
    await Promise.all(writes).catch((e) => console.error("development save failed", e));
    await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "FORM_DEVELOPMENT", summary: `Saved Player Development tracker for ${personIds.length} player(s)` });
    return back("&ok=1");
  }

  return back("&err=op");
}
