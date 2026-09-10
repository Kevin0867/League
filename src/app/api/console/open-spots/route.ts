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
