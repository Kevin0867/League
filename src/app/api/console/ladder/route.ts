import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

// Ladder mutations (§14, event types). Native-form-POST with ticket auth. The
// core rule: recording a challenge result where the LOWER-ranked entry wins
// swaps the two positions; a higher-ranked winner defends and positions hold.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/ladder${qs}`, origin), 303);

  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageScheduling")) return back("?err=auth");

  const op = String(formData.get("op") ?? "");

  switch (op) {
    case "createLadder": {
      const name = String(formData.get("name") ?? "").trim();
      if (!name) return back("?err=name");
      await prisma.ladder.updateMany({ where: { active: true }, data: { active: false } });
      const l = await prisma.ladder.create({ data: { name, active: true } });
      await audit({ actorId: actor.userId, entityType: "Ladder", entityId: l.id, action: "ladder.create", summary: `Created ladder ${name}` });
      return back("?ok=created");
    }

    case "addEntry": {
      const ladderId = String(formData.get("ladderId") ?? "");
      const teamId = String(formData.get("teamId") ?? "").trim() || null;
      let name = String(formData.get("name") ?? "").trim();
      if (!ladderId) return back("?err=noladder");
      if (teamId && !name) {
        const t = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
        name = t?.name ?? "Team";
      }
      if (!name) return back("?err=entryname");
      const agg = await prisma.ladderEntry.aggregate({ where: { ladderId }, _max: { position: true } });
      await prisma.ladderEntry.create({ data: { ladderId, teamId, name, position: (agg._max.position ?? 0) + 1 } });
      return back("?ok=added");
    }

    case "removeEntry": {
      const entryId = String(formData.get("entryId") ?? "");
      const entry = await prisma.ladderEntry.findUnique({ where: { id: entryId } });
      if (entry) {
        await prisma.ladderEntry.delete({ where: { id: entryId } });
        // Close the gap so positions stay contiguous.
        await prisma.ladderEntry.updateMany({ where: { ladderId: entry.ladderId, position: { gt: entry.position } }, data: { position: { decrement: 1 } } });
      }
      return back("?ok=removed");
    }

    // Record a challenge. The winner takes the better (lower-numbered) position;
    // if the winner was ranked below the loser, the two swap. W/L tallies update.
    case "recordChallenge": {
      const aId = String(formData.get("aId") ?? "");
      const bId = String(formData.get("bId") ?? "");
      const winnerId = String(formData.get("winnerId") ?? "");
      if (!aId || !bId || aId === bId) return back("?err=pickpair");
      if (winnerId !== aId && winnerId !== bId) return back("?err=pickwinner");
      const [a, b] = await Promise.all([
        prisma.ladderEntry.findUnique({ where: { id: aId } }),
        prisma.ladderEntry.findUnique({ where: { id: bId } }),
      ]);
      if (!a || !b || a.ladderId !== b.ladderId) return back("?err=pickpair");
      const winner = winnerId === aId ? a : b;
      const loser = winnerId === aId ? b : a;
      // Upset: winner ranked worse (higher position number) than the loser → swap.
      if (winner.position > loser.position) {
        await prisma.$transaction([
          prisma.ladderEntry.update({ where: { id: winner.id }, data: { position: loser.position } }),
          prisma.ladderEntry.update({ where: { id: loser.id }, data: { position: winner.position } }),
        ]);
      }
      await prisma.ladderEntry.update({ where: { id: winner.id }, data: { wins: { increment: 1 } } });
      await prisma.ladderEntry.update({ where: { id: loser.id }, data: { losses: { increment: 1 } } });
      await audit({ actorId: actor.userId, entityType: "Ladder", entityId: winner.ladderId, action: "ladder.challenge", summary: `${winner.name} def. ${loser.name}` });
      return back("?ok=challenge");
    }

    case "deleteLadder": {
      const ladderId = String(formData.get("ladderId") ?? "");
      if (ladderId) await prisma.ladder.delete({ where: { id: ladderId } });
      return back("?ok=deletedladder");
    }
  }

  return back("?err=op");
}
