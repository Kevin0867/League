import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { OPEN_SPOTS_COPY_KEYS } from "@/lib/domain/openSpots";

// Admin manager for the public /open-spots page: which teams advertise open
// spots (Team.acceptingSignups), each team's target size (Team.capacity), and
// the page headline/intro copy. One "Save" writes them all.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/open-spots${qs}`, origin), 303);

  const fd = await req.formData();
  const actor = await actorFromForm(fd);
  if (!actor || !can(actor.role, "manageTeams")) return back("?err=auth");

  const op = String(fd.get("op") ?? "save");
  const rawReturn = String(fd.get("returnTo") ?? "");

  // Single-team toggle from the Teams page (doesn't touch the page copy).
  if (op === "setTeam") {
    const teamId = String(fd.get("teamId") ?? "").trim();
    if (!teamId) return back("?err=team");
    const accepting = fd.get(`signup_${teamId}`) != null || fd.get("acceptingSignups") != null;
    const capRaw = parseInt(String(fd.get(`cap_${teamId}`) ?? fd.get("capacity") ?? ""), 10);
    const capacity = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null;
    await prisma.team.update({ where: { id: teamId }, data: { acceptingSignups: accepting, capacity } }).catch(() => {});
    await audit({ actorId: actor.userId, entityType: "Team", entityId: teamId, action: "OPEN_SPOTS", summary: accepting ? "Advertised open spots" : "Stopped advertising open spots" });
    const dest = rawReturn.startsWith("/console/") ? rawReturn : "/console/open-spots";
    // Anchor back to the team's card so the page keeps the reader in place instead
    // of jumping to the top. The hash must come AFTER the query string.
    const anchor = dest.startsWith("/console/teams") ? `#team-${teamId}` : "";
    return NextResponse.redirect(new URL(`${dest}${dest.includes("?") ? "&" : "?"}ok=openspots${anchor}`, origin), 303);
  }

  // Editable marketing copy.
  const headline = String(fd.get("headline") ?? "").trim();
  const intro = String(fd.get("intro") ?? "").trim();
  await prisma.siteContent.upsert({
    where: { key: OPEN_SPOTS_COPY_KEYS.headline },
    create: { key: OPEN_SPOTS_COPY_KEYS.headline, value: headline },
    update: { value: headline },
  });
  await prisma.siteContent.upsert({
    where: { key: OPEN_SPOTS_COPY_KEYS.intro },
    create: { key: OPEN_SPOTS_COPY_KEYS.intro, value: intro },
    update: { value: intro },
  });

  // Per-team availability + capacity. Every rendered team submits a hidden
  // teamId; an unchecked box just isn't present, so absence = off.
  const teamIds = fd.getAll("teamId").map(String).filter(Boolean);
  let changed = 0;
  for (const id of teamIds) {
    const accepting = fd.get(`signup_${id}`) != null;
    const capRaw = parseInt(String(fd.get(`cap_${id}`) ?? ""), 10);
    const capacity = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null;
    await prisma.team.update({ where: { id }, data: { acceptingSignups: accepting, capacity } }).catch(() => {});
    changed++;
  }

  await audit({ actorId: actor.userId, entityType: "Team", entityId: "bulk", action: "OPEN_SPOTS", summary: `Updated open-spots settings for ${changed} team(s)` });
  return back("?ok=1");
}
